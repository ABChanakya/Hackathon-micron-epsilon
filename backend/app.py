"""Run:  uvicorn app:app --port 8000   (from this folder)   ->  http://localhost:8000"""
import asyncio, os
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import hub as hubmod

app = FastAPI(title="Micro-Epsilon sensor backend")
hub = hubmod.Hub()


@app.on_event("startup")
async def _startup():
    hub.loop = asyncio.get_running_loop()


class ConnectReq(BaseModel):
    sensor: str = "SIM"            # "SIM" or a MEDAQLib name: ILD1420, ILD5500, ME-Bus, ...
    interface: str = "RS232"       # RS232 | TCP/IP | IF2004_USB ...
    port: str | None = None        # COM25 or /dev/ttyUSB0
    baudrate: int | None = None
    ip: str | None = None


class CmdReq(BaseModel):
    cmd: str                       # e.g. "Set_Samplerate", "Get_Setup"
    params: dict = {}              # e.g. {"SP_Measrate": 4.0}


async def _do(fn, *a):
    try:
        return await hub.call(fn, *a)
    except Exception as e:
        raise HTTPException(400, str(e))


@app.get("/api/sensors/scan")
def scan():
    # Simulator + any USB-serial ports (candidates for sensor "ILD1420-serial"; not probed until you connect).
    import glob
    ports = sorted(glob.glob("/dev/cu.usbserial*") + glob.glob("/dev/ttyUSB*"))
    return [{"sensor": "SIM", "model": "SIM-ILD1420", "interface": "virtual", "port": None, "serial": "SIM-0001"}] + \
           [{"sensor": "ILD1420-serial", "model": "serial port (unverified)", "interface": "serial", "port": p, "serial": None} for p in ports]


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


@app.post("/api/record/start")
async def rec_start():
    return await _do("_start_rec")


@app.post("/api/record/stop")
async def rec_stop():
    return await _do("_stop_rec")


@app.get("/api/recordings")
def recordings():
    d = hubmod.REC_DIR
    return sorted(os.listdir(d)) if os.path.isdir(d) else []


@app.get("/api/recordings/{name}")
def recording(name: str):
    p = os.path.join(hubmod.REC_DIR, os.path.basename(name))
    if not os.path.isfile(p):
        raise HTTPException(404)
    return FileResponse(p, filename=os.path.basename(name))


@app.websocket("/ws/stream")
async def stream(ws: WebSocket):
    await ws.accept()
    hub.clients.add(ws)
    try:
        while True:
            await ws.receive_text()   # keepalive; frames are pushed by the hub
    except WebSocketDisconnect:
        hub.clients.discard(ws)


STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
app.mount("/", StaticFiles(directory=STATIC, html=True), name="static")  # drop the Stitch export here
