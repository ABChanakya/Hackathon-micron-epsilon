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

import anomaly
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


@app.get("/api/device")
def device():
    """Device check of the connected source: family, what it measures, hardware/simulator/replay, verified, problems."""
    return hub.device()


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


class LabelReq(BaseModel):
    label: str                     # normal ("in Ordnung") | anomaly ("nicht in Ordnung")
    note: str = ""
    learn_s: float | None = None   # "normal": also learn the last N seconds (the window the person saw) as normal


@app.get("/api/ml")
def ml_status():
    """Anomaly agent: state, config, learned baseline, label counts, error file."""
    return hub.ml.status()


@app.get("/api/ml/config")
def ml_get_config():
    return hub.ml.status()["config"]


@app.put("/api/ml/config")
@app.post("/api/ml/config")
async def ml_set_config(body: dict):
    return await _do("_ml_config", body)


@app.get("/api/ml/events")
def ml_events(status: str | None = None, limit: int = 50):
    """Flagged and error events, newest first. status: pending | normal | anomaly | error."""
    return hub.ml.list_events(status, min(max(limit, 1), 200))


@app.post("/api/ml/events/{event_id}/label")
async def ml_label(event_id: str, r: LabelReq):
    if r.learn_s is not None and not 1 <= r.learn_s <= 900:
        raise HTTPException(400, "learn_s must be between 1 and 900")
    return await _do("_ml_label", event_id, r.label, r.note, r.learn_s)


@app.get("/api/ml/suggest")
def ml_suggest(seconds: float = 30):
    """Lowest and highest value of the last `seconds` (as the monitor shows them): what "fine" would confirm as the
    new evaluation limits. null while nothing was measured yet."""
    return hub.ml.suggest(min(max(seconds, 1), 900))


@app.post("/api/ml/learn_recent")
def ml_learn_recent(body: dict):
    """Learn the last N seconds as normal without an event (used when a limit deviation is accepted)."""
    seconds = float(body.get("seconds", 30))
    if not 1 <= seconds <= 900:
        raise HTTPException(400, "seconds must be between 1 and 900")
    return hub.ml.learn_recent(seconds, str(body.get("note", "")))


@app.post("/api/ml/reset")
async def ml_reset(body: dict | None = None):
    """Forget the learned baseline and learn again from the next seconds. keep_labels (default true) keeps the human labels."""
    return await _do("_ml_reset", bool((body or {}).get("keep_labels", True)))


@app.post("/api/ml/learn")
async def ml_learn(body: dict):
    """Learn a recording: {"file": "rec_....csv", "label": "normal" | "anomaly"}. It must come from the connected sensor."""
    label = body.get("label", "normal")
    if label not in ("normal", "anomaly"):
        raise HTTPException(400, "label must be normal or anomaly")
    path = _rec_path(body.get("file", ""))
    if not path.endswith(".csv"):
        raise HTTPException(400, "file must be a recording .csv")
    meta = {}
    try:
        with open(path[:-4] + ".json") as fh:
            meta = json.load(fh)
    except (OSError, ValueError):
        pass
    feats = await asyncio.to_thread(anomaly.features_from_csv, path, hub.ml.cfg["window_s"])
    if not feats:
        raise HTTPException(400, "the recording has no usable windows")
    return await _do("_ml_learn", meta.get("info") or {}, feats, label, meta.get("label") or os.path.basename(path))


@app.get("/api/ml/errors")
def ml_errors(limit: int = 50):
    """The last lines of the error file (errors are discarded from learning and written there)."""
    try:
        with open(hub.ml.error_path()) as fh:
            lines = fh.readlines()[-min(max(limit, 1), 500):]
    except OSError:
        return []
    return [json.loads(x) for x in reversed(lines) if x.strip()]


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
PHONE = next((p for p in (os.path.join(FRONTEND, "..", "Handy frontend"), os.path.join(FRONTEND, "..", "..", "Handy frontend"))
              if os.path.isfile(os.path.join(p, "index.html"))), None)
if PHONE:    # the phone view; on a phone use its own relay (Handy frontend/serve.py), which reads this API
    app.mount("/handy", StaticFiles(directory=PHONE, html=True), name="handy")
app.mount("/", StaticFiles(directory=FRONTEND if os.path.isfile(os.path.join(FRONTEND, "index.html")) else STATIC,
                           html=True), name="static")
