# Sensor backend

FastAPI service between a Micro-Epsilon ILD1420/ILD1900 sensor or thermoMETER UC (or a simulator, or a recording) and the web UI.
The API contract is in [API.md](API.md).

## Run
```
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app:app --port 8000
```
Open http://localhost:8000. The backend serves the monitor from `../frontend/dist/`, so the dashboard, API and WebSocket
share one origin. The static paths work independently of the server's working directory.
The server starts disconnected and does not select or reconfigure a sensor automatically.
The old API test page remains available at http://localhost:8000/diagnostics/; its source controls are explicit actions.
For a backend-only checkout without `frontend/dist/index.html`, that test page is also used as the home page.

Connect the real sensor (macOS port name shown; on Linux it is `/dev/ttyUSB0`):
```
curl -X POST localhost:8000/api/connect -H 'content-type: application/json' \
     -d '{"sensor":"ILD1420-serial","port":"/dev/cu.usbserial-000101"}'
```
The same serial source detects an ILD1900 automatically. Use `GET /api/sensors/scan` to find the actual USB port;
the port above is an example. `pyserial` is included in `requirements.txt`.
While connected the sensor streams over RS422 and its 4-20 mA analog output is off. Disconnecting, or stopping the server
with Ctrl+C, switches it back. If the server is killed hard (`kill -9`), reconnect and disconnect once to restore it.

Connect the thermoMETER UC infrared thermometer (3.3 V TTL USB cable):
```
curl -X POST localhost:8000/api/connect -H 'content-type: application/json' \
     -d '{"sensor":"thermo","port":"/dev/cu.usbserial-FTA3RQ8E"}'
```
It streams °C at about 55 readings per second; the monitor website switches to °C by itself when it connects.

## Record several materials in one go (guided)
```
cd backend
python3 record_materials.py              # real sensor (USB port found automatically)
python3 record_materials.py --sensor SIM # practice run without a sensor
```
It asks for a material name, waits until you have placed it (it checks that the sensor sees it and that it holds still),
then records two 10 s takes: the sensor's median averaging and no averaging. Press Enter on an empty name to finish.
Options: `--seconds 10`, `--rate 4` (kHz), `--takes median,none,moving`, `--port /dev/cu.usbserial-...`.
Only one program can use the sensor at a time, so close sensorTOOL and stop any other backend first.
The target must sit inside the sensor's window (ILD1420-50: 35-85 mm, ILD1900-10: 20-30 mm from the sensor face).
Ctrl+C is safe: the sensor is put back the way it was.

## Making data with only the sensor
The ILD1420-50 measures **35-85 mm from the sensor face**. Point it down at the desk from a stack of books, or at a
wall. Record each scene for 10-30 s with a label:
```
curl -X POST localhost:8000/api/record/start -H 'content-type: application/json' \
     -d '{"label":"hand sweep","duration_s":20}'
```
1. **Static baseline:** aimed at the desk, nothing moving. Shows noise and repeatability.
2. **Hand sweep:** move a flat hand slowly through 35-85 mm. Covers the full range, with "peak before/after range" errors at the ends.
3. **Surfaces:** white paper, the desk, a phone screen, fabric, the keyboard. `intensity_pct` and `shutter_us` change.
4. **Steps:** slide a book or phone in and out of the beam. Gives sharp edges.
5. **Vibration:** tap the desk, or put a vibrating phone on it. Best at 4 kHz (`{"rate_khz": 4}` via `/api/settings`).
6. **Settings comparison:** the same scene with averaging `MEDIAN 9` and `NONE`, and at 0.25 kHz and 4 kHz.
7. **Out of range:** point it at empty space. A clean error-state recording, useful for the UI's error banner.

Recordings are in `recordings/` (CSV plus a `.json` with label and stats). Play one back without the sensor:
`{"sensor":"REPLAY","file":"rec_….csv"}` on `/api/connect`.

## Tests
From `backend/`, install `requirements-dev.txt`, then run:
```
python -m unittest discover -s tests
```
The checks use isolated in-process simulator and temperature fixtures and do not open a serial port or contact a running backend.
