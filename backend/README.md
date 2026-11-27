# Sensor backend

FastAPI service between a Micro-Epsilon ILD1420 sensor (or a simulator, or a recording) and the web UI.
The API contract is in [API.md](API.md).

## Run
```
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app:app --port 8000
```
Open http://localhost:8000. The test page connects to the simulator. Put the UI build into `static/`.

Connect the real sensor (macOS port name shown; on Linux it is `/dev/ttyUSB0`):
```
curl -X POST localhost:8000/api/connect -H 'content-type: application/json' \
     -d '{"sensor":"ILD1420-serial","port":"/dev/cu.usbserial-000101"}'
```
While connected the sensor streams over RS422 and its 4-20 mA analog output is off. Disconnecting, or stopping the server
with Ctrl+C, switches it back. If the server is killed hard (`kill -9`), reconnect and disconnect once to restore it.

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
