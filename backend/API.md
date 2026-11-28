# Sensor backend API

Base URL: `http://localhost:8000`. Run `uvicorn app:app --port 8000` in `backend/`.
The backend also serves the monitor from `frontend/dist/`, so the UI and the API share one origin and CORS is not needed.
The legacy API test page is at `/diagnostics/` (and at `/` when the frontend checkout is absent).
Starting the server leaves the source disconnected; only `POST /api/connect` selects or changes a source.
All bodies are JSON. Errors come back as HTTP 400 `{"detail": "<message>"}`, with 404 or 409 where noted.

## Concepts
- One source at a time:
  - `SIM`: a built-in simulator.
  - `ILD-serial` (or `ILD1420-serial`): the real sensor over USB serial. The model is read from the sensor.
    Verified on an ILD1420-50 and an ILD1900-10, and it works on macOS.
  - `REPLAY`: plays back a recording.
  - MEDAQLib sensor names: Windows/Linux only, untested.
  - `thermo`: a thermoMETER UC infrared thermometer over ME-Bus (its 3.3 V TTL USB cable). Verified on a UC-SF22-S3.
- The raw stream (up to 4 kHz) is reduced to **~25 frames/s** for the browser.
- Invalid readings never appear as values. They are counted (`errors_in_window`) and described (`last_error`).
- All distances are in **mm from the start of the measuring range**. `dist_from_face_mm` adds the start of the
  measuring range (`info.smr_mm`). For the ILD1420-50 the range is 35-85 mm from the sensor face.

## State object
Returned by `/api/status`, `/api/connect`, `/api/disconnect`, `/api/record/*`, `/api/tare`.
```json
{
  "status": "disconnected | streaming | error",
  "error": "",
  "source": "sim | serial-ild1420 | serial-ild1900 | thermo-uc | replay | medaqlib | null",
  "info": {"model": "ILD1420-50", "serial": "15060171", "range_mm": 50.0, "smr_mm": 35, "firmware": "000.018", "unit": "mm"},
  "recording": false, "rec_file": null, "rec_samples": 0, "rec_label": null,
  "rec_until_s": null,              // seconds left of a timed recording
  "tare_mm": null,                  // active software zero, or null
  "dropped_total": 0,               // samples lost between sensor and PC (from the sensor counter)
  "cfg": {}
}
```
For `REPLAY`, `info` is the recorded sensor's info plus `replay_of`, `label` and `duration_s`.

## REST endpoints
| Method & path | Body / query | Returns | Purpose |
|---|---|---|---|
| `GET /api/status` | – | State | Connection, recording and tare state |
| `GET /api/latest` | – | frame \| null | The most recent live frame (same fields as the WebSocket). For scripts and polling |
| `GET /api/sensors/scan` | – | list | Simulator, USB serial ports (not probed) and recordings (as `REPLAY` entries) |
| `POST /api/connect` | see below | State | Open a source (closes the previous one) |
| `POST /api/disconnect` | – | State | Close it. Stops any recording; a real sensor gets its settings back |
| `GET /api/settings` | – | settings | Current settings and the allowed `options` |
| `POST /api/settings` | any subset of `{rate_khz, averaging, channels}` (`REPLAY`: `{speed, loop}`) | settings | Change settings |
| `POST /api/tare` | `{"on": true \| false}` | State | Software zero: subtract the current 1 s mean from displayed values. Recordings stay raw |
| `GET /api/history?seconds=10&bins=300` | – | `[{t, min, max, mean}]` | Recent valid readings, bucketed (prefills the live chart; tare applied) |
| `POST /api/record/start` | `{label?, notes?, duration_s?}` | State | Start a recording. With `duration_s` it stops by itself |
| `POST /api/record/stop` | – | State | Stop it and finish the metadata |
| `GET /api/recordings` | – | `[metadata]` | All recordings, newest first (see "Recordings") |
| `GET /api/recordings/{file}/series?bins=500&channel=dist_mm` | – | `[{t, min, max, mean}]` | A recording bucketed for a chart. `t` = seconds from its start. `channel` is any numeric CSV column |
| `GET /api/recordings/{file}` | – | file | Download the CSV (or the `.json` sidecar) |
| `DELETE /api/recordings/{file}` | – | `{deleted}` | Delete the CSV and its sidecar. 409 while it is being recorded |
| `POST /api/command` | `{cmd, params?}` | `{answer}` | Raw sensor command (advanced) |
| `POST /api/config` | `{"rate_khz": 2}` | `{answer}` | Older shortcut for the rate; prefer `/api/settings` |

### `POST /api/connect`
| Field | Example | Notes |
|---|---|---|
| `sensor` | `"SIM"`, `"ILD-serial"`, `"thermo"`, `"REPLAY"`, `"ILD1420"` | Source type |
| `port` | `"/dev/cu.usbserial-000101"`, `"COM25"` | Serial. `ILD1420-serial` defaults to 921600 baud |
| `channels` | `["COUNTER","INTENSITY","STATE","TIMESTAMP","SHUTTER"]` | Extra values per sample (default: all) |
| `file` | `"rec_20261127_181128.csv"` | `REPLAY` only |
| `speed`, `loop` | `1.0`, `true` | `REPLAY` only |
| `restore_output` | `"ANALOG"` | `ILD1420-serial`: OUTPUT mode to set on disconnect |
| `address` | `126` | `thermo` ME-Bus address |
| `baudrate` | `921600` or `115200` | Serial baud rate; defaults depend on source |
| `interface`, `ip` | | MEDAQLib sensors only |

```json
{"sensor": "SIM"}
{"sensor": "ILD1420-serial", "port": "/dev/cu.usbserial-000101"}
{"sensor": "REPLAY", "file": "rec_20261127_181128.csv", "speed": 1, "loop": true}
```

### Settings
```json
{
  "rate_khz": 2.0,
  "averaging": {"mode": "MEDIAN", "depth": 9},
  "channels": ["COUNTER","INTENSITY","STATE","TIMESTAMP","SHUTTER"],   // what was asked for
  "channels_active": ["COUNTER","INTENSITY","STATE","TIMESTAMP","SHUTTER"],  // what fits the bandwidth at this rate
  "options": {"rate_khz": [0.25, 0.5, 1, 2, 4], "averaging": {"NONE": [], "MOVING": [2,4,...,128],
              "RECURSIVE": "2..32767", "MEDIAN": [3,5,7,9]}, "channels": ["COUNTER","INTENSITY","STATE","TIMESTAMP","SHUTTER"]}
}
```
- **Build the UI controls from `options`.** It only lists rates this sensor accepts. The connected ILD1420-50 rejects 8 kHz
  (E236, laser class 1 models are limited to 4 kHz, manual p.16). Trying it returns HTTP 400, and 8 is removed from `options`.
- The serial line carries about 26,000 values/s. At 4 kHz `SHUTTER` is dropped automatically, so check `channels_active`.
- A real sensor pauses its stream for about 0.5 s while settings change. This is not counted as dropped data.
- Settings are read at connect and then tracked; changes made in sensorTOOL during a session are not seen. They are
  not saved on the sensor, so it reverts after a power cycle. The backend restores `OUTPUT` and `OUTADD_RS422` on disconnect and on server stop.
- `ILD1420-serial` also returns `order` (the sensor's frame layout) and `raw` (all sensor settings).

## WebSocket `/ws/stream`
Server → client only, about 25 frames/s while streaming:
```json
{
  "t": 3508.4,                          // s, monotonic clock (x-axis spacing, not wall time)
  "source": "serial-ild1420",            // sim | serial-ild1420 | serial-ild1900 | replay | medaqlib
  "info": {"model": "ILD1420-50", "serial": "15060171", "range_mm": 50, "smr_mm": 35, "unit": "mm"},
  "value": 8.42,                        // latest valid distance (mm, tare applied), null if none in the last 1 s
  "min": 8.40, "max": 44.18, "mean": 25.1,   // last 1 s of valid readings (tare applied), null if none
  "n": 1997,                            // valid readings in that window
  "dist_from_face_mm": 43.42,           // latest valid reading + smr_mm (tare NOT applied), null if unknown
  "tare_mm": null,
  "errors_in_window": 3,
  "last_error": {"code": 4, "text": "no peak/edge"},
  "intensity": 15.1,                    // % of signal intensity, mean since the last frame (null if channel off)
  "shutter_us": 496.1,                  // exposure time of the latest sample
  "counter": 115802,                    // sensor measurement counter (18 bit, wraps)
  "sensor_ts_ms": 3063785.33,           // sensor clock, 0.01 ms resolution
  "state": 131140,                      // raw status word
  "state_flags": {"peak_before_roi": false, "peak_after_roi": false, "no_peak": true,
                  "before_smr": false, "after_emr": true, "triggered": false, "led": "red"},
  "dropped_total": 0,
  "rate_hz": 1997, "status": "streaming", "recording": true, "rec_samples": 2883
}
```
- Any field can be `null`. The extra fields are null when their channel is off.
- Every frame carries `source` and the current source's `info`, including replay labels when available. Clients can
  detect source/model changes without another status request and distinguish live measurements from playback.
- `state_flags.led` mirrors the LED on the sensor: green = target in range, yellow = mid range, red = error, off = laser off.
- `last_error.code`: 3 too much data for baudrate, 4 no peak, 5 peak before range, 6 peak after range, 7 cannot be calculated,
  8 global error, 9 peak too wide, 10 laser off.

## Thermometer (`thermo`, thermoMETER UC over ME-Bus)
Connect: `{"sensor": "thermo", "port": "/dev/cu.usbserial-FTA3RQ8E"}` (optional `"address": 126`, `"baudrate": 115200`).
`info` is `{"model": "UC-SF22-S3", "unit": "°C", "range_min": -50, "range_max": 900, "channels": {...}}`.

- The WebSocket frame is the same as for distance sensors, in °C: `value`, `min`, `max`, `mean`, `raw_value` (latest
  reading, no tare), `unit: "°C"`, plus `head_c` (sensor head) and `electronics_c` (electronics) temperatures.
  `dist_from_face_mm`, `intensity`, `state_flags` and `shutter_us` are null. About 55 readings per second.
- `dropped_total` counts readings lost between sensor and computer (from the sensor's own 16-bit sample counter).
- Recordings: CSV columns `t_s, wall_time, temp_c, error_code, counter, head_c, electronics_c`; the sidecar has `"unit": "°C"`
  (its `min_mm`, `max_mm`, `mean_mm` are then in °C). Replay works the same way.
- Settings are **read-only**: `POST /api/settings` and `/api/command` return HTTP 400. Emissivity and averaging stay as set on the sensor.
- The protocol (PROFIBUS-style FDL telegrams at 115200 baud, 8E1) was taken from MEDAQLib's trace log in
  `software/MEDAQLib_samples/` and verified on the sensor; details in `ThermoSource` in `sources.py`. The channel names come
  from that log; that channel 2 is the sensor head and channel 3 the electronics follows MEDAQLib's order and is not otherwise confirmed.

## Browser access (CORS)
Pages on `localhost` or `127.0.0.1` (any port) may call the API, so the monitor website and the landing page can read
`/api/status`. Other sites are refused.

## WebSocket `/ws/bridge` (for the sensor-monitor website in `frontend/`)
The same live data as `/ws/stream`, in the message format that the website's "local sensor bridge" connection expects
(`frontend/dist/app.js`, function `connectBridge`). In the website, enter `ws://localhost:8000/ws/bridge` as the bridge address.
About 25 messages per second:
```json
{
  "value": 24.375,            // distance sensors: mm FROM THE SENSOR FACE; thermometer: °C. null = nothing valid right now
  "unit": "mm",               // "°C" for the thermometer
  "sensor": "ILD1900",        // the real model name from the sensor
  "source": "serial-ild1900",  // "replay" for recorded data, "sim" for simulation
  "info": {"model": "ILD1900-10", "range_mm": 10, "smr_mm": 20, "unit": "mm"},
  "current_valid": true,      // false for a received frame without a valid measurement
  "state": "green",           // status LED: green | yellow | red | off | unknown
  "output": "green",          // output LED: "green" while the RS422 stream runs
  "serial": "00323100070",
  "range_start": 20, "range_end": 30, "range": 10,   // measuring window in mm from the face, from the connected sensor
  "rate_hz": 4000, "intensity": 46.1, "dropped_total": 0, "t": 15615.1,
  "error": null               // text such as "no peak/edge" when value is null
}
```
- `value` is the latest reading (the tare is **not** applied: the website has its own zero). Messages with `value: null` and
  `current_valid: false` mean that a frame arrived without a valid measurement. A UI should show "no target" with `error`,
  keep its connection alive and avoid adding a measurement point.
- Check the sensor model and measuring window before displaying values. `source` distinguishes hardware, simulation and replay.
- `info` carries the same source metadata as the native stream. For thermometers, use `info.range_min` and `info.range_max`;
  the distance-specific `range_start`, `range_end` and `range` fields are null.
- A browser page served over `https://` may refuse `ws://localhost` (Safari does). Open the website over `http://` locally.

The included monitor supports optoNCDT 1900-10 distance measurements (20–30 mm from the face) and thermoMETER UC
temperatures. Other connected models remain available through this API and the diagnostics page; clients must validate
model, unit and measuring range against their selected profile.

## Recordings
`backend/recordings/rec_YYYYMMDD_HHMMSS.csv`, with one row per sensor sample:

| Column | Meaning |
|---|---|
| `t_s` | Monotonic seconds (same clock as the WS `t`) |
| `wall_time` | Unix time (seconds) |
| `dist_mm` | Distance from the start of the measuring range. Empty for an invalid reading |
| `error_code` | Set for an invalid reading (see the codes above) |
| `counter`, `sensor_ts_ms`, `intensity_pct`, `shutter_us`, `state` | Extra channels. Empty when the channel is off |

Sidecar `rec_….json` (also what `GET /api/recordings` returns, plus `size_bytes` and `active`):
```json
{"file": "rec_….csv", "label": "hand sweep", "notes": "", "source": "serial-ild1420", "info": {...},
 "settings": {"rate_khz": 2.0, "averaging": {...}, "channels_active": [...], "order": [...]},
 "tare_mm": null, "started": "2026-11-27T18:11:28", "stopped": "2026-11-27T18:11:31", "duration_s": 3.021,
 "planned_duration_s": 3, "samples": 6023, "valid": 5900, "errors": 123, "errors_by_code": {"6": 123},
 "dropped": 0, "min_mm": 2.1, "max_mm": 48.7, "mean_mm": 21.3}
```
While a recording runs, its sidecar has `stopped: null`. Older recordings (before this format) have no sidecar, and
the list shows only `file` for them.

Replay: `POST /api/connect {"sensor": "REPLAY", "file": "..."}` streams the recording through the same WebSocket,
paced by its `t_s`. Use it for UI work and demos without the sensor. `POST /api/settings {"speed": 4}` changes the speed.

## Not built
- Multi-sensor mode, the raw video signal, and hardware mastering (`MASTERMV`). Use `/api/tare` for zeroing the display.
- Real discovery: scan lists serial ports but does not probe them.
- MEDAQLib sensors are untested, because the MEDAQLib DLL is Windows-only.
