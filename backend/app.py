"""Sensor backend. Run ./start.sh in the repository root (or: uvicorn app:app --port 8000 in this folder).

One port serves everything:
  /               the monitor (frontend/dist)
  /pitch/         the pitch landing page (scrollcraft/builds/landing)
  /diagnostics/   a plain diagnostic page (backend/static)
  /api/...        REST API, /ws/stream and /ws/bridge   (see API.md)
"""
import asyncio, csv, glob, json, os
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import hub as hubmod
from sources import probe_port, serial_ports

app = FastAPI(title="Micro-Epsilon sensor backend")
# The monitor website and the landing page run on their own local ports and read /api/status, so allow
# requests from local pages only (any port on localhost / 127.0.0.1), never from other sites.
app.add_middleware(CORSMiddleware, allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
                   allow_methods=["*"], allow_headers=["*"])
hub = hubmod.Hub()


@app.on_event("startup")
async def _startup():
    hub.loop = asyncio.get_running_loop()


@app.on_event("shutdown")
async def _shutdown():
    # Close the sensor on server stop (Ctrl+C / SIGTERM) so a real sensor gets its OUTPUT/OUTADD settings back.
    try:
        await asyncio.wait_for(hub.call("_disconnect"), 5)
    except Exception:
        pass


class ConnectReq(BaseModel):
    sensor: str = "SIM"            # AUTO (find it) | ILD-serial | thermo | SIM | REPLAY | a MEDAQLib name (ILD1420, ...)
    interface: str = "RS232"       # RS232 | TCP/IP | IF2004_USB ...
    port: str | None = None        # COM25 or /dev/ttyUSB0
    baudrate: int | None = None
    ip: str | None = None
    address: int | None = None          # thermo: ME-Bus address (default 126)
    channels: list[str] | None = None   # ILD-serial / SIM: extra values, e.g. ["COUNTER","INTENSITY","STATE","TIMESTAMP","SHUTTER"]
    restore_output: str | None = None    # ILD-serial: OUTPUT mode to set on disconnect
    file: str | None = None              # REPLAY: recording file name (rec_....csv)
    files: list[str] | None = None       # REPLAY: several recordings played back to back (playlist)
    speed: float = 1.0                   # REPLAY: playback speed
    loop: bool = True                    # REPLAY: restart at the end


class RecReq(BaseModel):
    label: str = ""
    notes: str = ""
    duration_s: float | None = None      # stop automatically after this many seconds


class CmdReq(BaseModel):
    cmd: str                       # e.g. "Set_Samplerate", "Get_Setup"
    params: dict = {}              # e.g. {"SP_Measrate": 4.0}


async def _do(fn, *a):
    try:
        return await hub.call(fn, *a)
    except Exception as e:
        raise HTTPException(400, str(e))


@app.get("/api/latest")
def latest():
    """The most recent live frame (same fields as the WebSocket), or null before the first one. For scripts and polling."""
    return hub.last_frame


@app.get("/api/sensors/scan")
def scan(probe: bool = False):
    """Simulator, USB serial ports and recordings. Without ?probe each port is listed once per sensor type as an
    unverified candidate. With ?probe=true each free port is asked (read-only) which sensor it has."""
    in_use = hub.cfg.get("port") if hub.src else None
    ports = []
    for p in serial_ports():
        if p == in_use:
            kind = hub.cfg.get("sensor")
            ports.append({"sensor": kind, "model": (hub.src.info or {}).get("model"),
                          "interface": "ME-Bus" if kind == "thermo" else "serial", "port": p, "in_use": True})
        elif probe:
            found = probe_port(p)
            if found:
                ports.append({**found, "interface": "ME-Bus" if found["sensor"] == "thermo" else "serial", "verified": True})
        else:
            ports += [{"sensor": "ILD-serial", "model": "optoNCDT (unverified)", "interface": "serial", "port": p, "serial": None},
                      {"sensor": "thermo", "model": "thermoMETER UC (unverified)", "interface": "ME-Bus", "port": p, "serial": None}]
    return [{"sensor": "SIM", "model": "SIM-ILD1900-10", "interface": "virtual", "port": None, "serial": "SIM-0001"}] + ports + \
           [{"sensor": "REPLAY", "model": "recording", "interface": "file", "file": r["file"], "label": r.get("label", "")}
            for r in recordings()]


@app.post("/api/connect")
async def connect(r: ConnectReq):
    return await _do("_connect", r.model_dump())


@app.post("/api/disconnect")
async def disconnect():
    return await _do("_disconnect")


@app.get("/api/status")
def status():
    return hub.state()


@app.post("/api/command")
async def command(r: CmdReq):
    return {"answer": await _do("_command", r.cmd, r.params)}


@app.post("/api/config")
async def config(body: dict):
    """Convenience: {"rate_khz": 4.0} -> SP_Measrate + Set_Samplerate."""
    if "rate_khz" in body:
        return {"answer": await _do("_command", "Set_Samplerate", {"SP_Measrate": float(body["rate_khz"])})}
    raise HTTPException(400, "unknown config key; use /api/command for raw commands")


@app.get("/api/settings")
async def get_settings():
    return await _do("_settings")


@app.post("/api/settings")
async def set_settings(body: dict):
    """{"rate_khz": 4, "averaging": {"mode": "MEDIAN", "depth": 9}} - any subset. Returns the new settings."""
    return await _do("_apply", body)


@app.get("/api/history")
async def history(seconds: float = 10, bins: int = 300):
    return await _do("_history", min(max(seconds, 0.1), 300), min(max(bins, 10), 2000))


@app.post("/api/tare")
async def tare(body: dict):
    """{"on": true} zeroes the displayed value on the current 1 s mean; {"on": false} clears it. Recordings stay raw."""
    return await _do("_set_tare", bool(body.get("on", True)))


@app.post("/api/record/start")
async def rec_start(r: RecReq | None = None):
    r = r or RecReq()
    return await _do("_start_rec", r.label, r.notes, r.duration_s)


@app.post("/api/record/stop")
async def rec_stop():
    return await _do("_stop_rec")


def _rec_path(name):
    p = os.path.join(hubmod.REC_DIR, os.path.basename(name))
    if not os.path.isfile(p):
        raise HTTPException(404, f"no recording {name}")
    return p


@app.get("/api/recordings")
def recordings():
    """Newest first. Each entry is the metadata sidecar; old recordings without one only have file and size."""
    out = []
    for p in sorted(glob.glob(os.path.join(hubmod.REC_DIR, "rec_*.csv")), reverse=True):
        side = p[:-4] + ".json"
        meta = {"file": os.path.basename(p)}
        if os.path.isfile(side):
            try:
                with open(side) as f:
                    meta = json.load(f)
            except Exception:
                pass
        meta["size_bytes"] = os.path.getsize(p)
        meta["active"] = hub.rec is not None and hub.rec_path == p
        out.append(meta)
    return out


@app.get("/api/recordings/{name}/series")
def recording_series(name: str, bins: int = 500, channel: str = "dist_mm"):
    """A recording bucketed for charting: [{t (s from start), min, max, mean}]. Error rows are skipped."""
    p = _rec_path(name)
    pts = []
    with open(p, newline="") as f:
        for row in csv.DictReader(f):
            col = row.get(channel)
            if col is None and channel == "dist_mm":            # temperature recordings store temp_c, old ones "value"
                col = row.get("temp_c", row.get("value"))
            if col in (None, "") or col.startswith("ERR"):
                continue
            try:
                pts.append((float(row["t_s"]), float(col)))
            except ValueError:
                continue
    if not pts:
        return []
    t0 = pts[0][0]
    pts = [(t - t0, v) for t, v in pts]
    return hubmod.bucketize(pts, 0.0, pts[-1][0], min(max(bins, 10), 5000))


@app.get("/api/recordings/{name}")
def recording(name: str):
    p = _rec_path(name)
    return FileResponse(p, filename=os.path.basename(p))


@app.delete("/api/recordings/{name}")
def delete_recording(name: str):
    p = _rec_path(name if name.endswith(".csv") else name + ".csv")
    if hub.rec is not None and hub.rec_path == p:
        raise HTTPException(409, "recording in progress; stop it first")
    os.remove(p)
    if os.path.isfile(p[:-4] + ".json"):
        os.remove(p[:-4] + ".json")
    return {"deleted": os.path.basename(p)}


@app.websocket("/ws/stream")
async def stream(ws: WebSocket):
    await ws.accept()
    hub.clients.add(ws)
    try:
        while True:
            await ws.receive_text()   # keepalive; frames are pushed by the hub
    except WebSocketDisconnect:
        hub.clients.discard(ws)


@app.websocket("/ws/bridge")
async def bridge(ws: WebSocket):
    """Same data as /ws/stream, in the message format of the sensor-monitor website (frontend/): see API.md."""
    await ws.accept()
    hub.bridge_clients.add(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        hub.bridge_clients.discard(ws)


STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
FRONTEND = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "frontend", "dist")
LANDING = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scrollcraft", "builds", "landing")
# Keep the diagnostic controls available while the monitor and its API share one origin.
app.mount("/diagnostics", StaticFiles(directory=STATIC, html=True), name="diagnostics")
if os.path.isfile(os.path.join(LANDING, "index.html")):
    app.mount("/pitch", StaticFiles(directory=LANDING, html=True), name="pitch")
app.mount("/", StaticFiles(directory=FRONTEND if os.path.isfile(os.path.join(FRONTEND, "index.html")) else STATIC,
                           html=True), name="static")
