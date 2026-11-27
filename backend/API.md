# Sensor backend API

Base URL: `http://localhost:8000` (run `uvicorn app:app --port 8000` in `backend/`).
The backend also serves the UI from `backend/static/`, so the UI and the API share one origin (no CORS).
All bodies are JSON. Errors from the sensor come back as HTTP 400 `{"detail": "<message>"}`.

## Concepts
- One sensor at a time. `sensor: "SIM"` is a built-in simulator (no hardware needed).
- The raw sensor stream (up to kHz) is reduced to **~25 frames/s** before it reaches the browser.
- Invalid readings never appear as values. They are counted in `errors_in_window` and described in `last_error`.

## State object
Returned by `/api/status`, `/api/connect`, `/api/disconnect`, `/api/record/*`.
```json
{
  "status": "disconnected | streaming | error",
  "error": "",                         // message when status = error
  "source": "sim | medaqlib | null",
  "info": {"model": "SIM-ILD1420", "serial": "SIM-0001", "range_mm": 25.0, "unit": "µm"},
  "recording": false,
  "rec_file": null,                    // e.g. "rec_20261127_165850.csv"
  "rec_samples": 0,
  "cfg": {}                            // the connect request in use
}
```
`info.unit` is `"µm"` for the simulator and `"mm"` for a real sensor (real model/serial/range are not read yet).

## REST endpoints
| Method & path | Body | Returns | Purpose |
|---|---|---|---|
| `GET /api/status` | – | State | Current connection/recording state |
| `GET /api/sensors/scan` | – | `[{sensor, model, interface, port, serial}]` | List sensors. **Only returns the simulator for now**; real discovery is not built |
| `POST /api/connect` | `{sensor, interface?, port?, baudrate?, ip?}` | State | Open a sensor (closes any previous one) |
| `POST /api/disconnect` | – | State | Close sensor, stop any recording |
| `POST /api/config` | `{"rate_khz": 4.0}` | `{answer}` | Change sample rate (see unit warning) |
| `POST /api/command` | `{cmd, params?}` | `{answer}` | Raw MEDAQLib sensor command |
| `POST /api/record/start` | – | State | Start writing a CSV |
| `POST /api/record/stop` | – | State | Stop and close the CSV |
| `GET /api/recordings` | – | `["rec_….csv"]` | List saved recordings |
| `GET /api/recordings/{name}` | – | CSV file | Download a recording |

### `POST /api/connect`
| Field | Example | Notes |
|---|---|---|
| `sensor` | `"SIM"`, **`"ILD1420-serial"`**, `"ILD1420"`, `"ILD5500"`, `"ME-Bus"` | `SIM`; `ILD1420-serial` = direct serial protocol, **works on macOS and is verified on real hardware**; others go through MEDAQLib (Windows/Linux, untested) |
| `interface` | `"RS232"`, `"TCP/IP"`, `"IF2004_USB"` | USB-RS422 converters (IF2001) use `"RS232"` |
| `port` | `"COM25"`, `"/dev/cu.usbserial-000101"` | Serial. For `ILD1420-serial` the baudrate defaults to 921600 |
| `baudrate` | `115200` | Serial only |
| `ip` | `"169.254.168.150"` | `TCP/IP`; sent as `IP_RemoteAddr`, required in that case |

Examples:
```json
{"sensor": "SIM"}
{"sensor": "ILD1420-serial", "port": "/dev/cu.usbserial-000101"}
{"sensor": "ILD1420", "interface": "RS232", "port": "COM25", "baudrate": 115200}
{"sensor": "ILD5500", "interface": "TCP/IP", "ip": "169.254.168.150"}
```

### `POST /api/config`
`{"rate_khz": 4.0}`. Unit is **kHz**. For `ILD1420-serial` the allowed values are `0.25, 0.5, 1, 2, 4, 8`
(anything else returns HTTP 400); verified on hardware. For MEDAQLib sensors the value is passed through
unchanged as `SP_Measrate`, and some sensors expect Hz instead (MEDAQLib.pdf p.160 vs p.1355), so check per model.

### `POST /api/command`
`{"cmd": "Get_Setup", "params": {"SP_Measrate": 4.0}}`
Sets each parameter, then runs the command. For `ILD1420-serial` the command is a raw ASCII command of the sensor and `params.args` is appended, e.g.
`{"cmd": "AVERAGE", "params": {"args": "MEDIAN 9"}}` (set) or `{"cmd": "AVERAGE"}` (query → `"AVERAGE MEDIAN 9"`),
`{"cmd": "GETINFO"}`, `{"cmd": "PRINT"}`. **These change real sensor settings** (volatile until saved on the sensor).
For MEDAQLib sensors parameters are typed by JSON type: integer or boolean → int,
number with decimals → double, anything else → string. For a real sensor `answer` is the full MEDAQLib
parameter dump. Useful for the "run `Get_Setup`, change a setting in sensorTOOL, run it again, diff" trick.

## WebSocket `/ws/stream`
Server → client only. The client can ignore anything it sends. Frame (~25/s while streaming):
```json
{
  "t": 3508.4,                 // seconds, monotonic clock (not wall-clock; use for x-axis spacing)
  "value": 8518.9,             // latest valid reading, null if none in the last second
  "min": 8504.9, "max": 16539.1, "mean": 12766.9,   // over the last 1 s of valid readings, null if none
  "n": 1997,                   // valid readings in that 1 s window
  "errors_in_window": 3,       // invalid readings in that window
  "last_error": {"code": 4, "text": "no peak/edge"},   // null until the first error since connect
  "rate_hz": 1997,             // measured samples/s (smoothed)
  "status": "streaming",
  "recording": true,
  "rec_samples": 2883
}
```
`value`, `min`, `max`, `mean` can be **`null`**: the UI must handle it (gap in the line, show "–").
`last_error.code` meanings (MEDAQLib.pdf p.135): 1 scaling underflow, 2 scaling overflow, 3 too much data for baudrate,
4 no peak/edge, 5 peak before range, 6 peak after range, 7 cannot be calculated, 8 global error, 9 peak too wide,
10 laser off. Not every sensor reports every code.

The stream carries no frames while `status` is not `streaming`. Poll `/api/status` (or reconnect the socket) to see
`error` messages. Frames include the status, so the UI should show a banner on `status != "streaming"`.

## Recordings
CSV with header `t_s,value`. `t_s` is the same monotonic clock as `t`. An invalid reading is written as `ERR<code>`
(for example `ERR4`) instead of a number. Files are in `backend/recordings/`.

## Real sensor notes (`ILD1420-serial`, tested on an ILD1420-50)
- On connect the backend reads `GETINFO` (model, serial, range, firmware) into `info`, remembers the sensor's current
  `OUTPUT` mode, and switches it to `RS422` to start the stream. **This turns the 4-20 mA analog output off.**
  On disconnect it restores the previous mode (`ANALOG` if it was already `RS422`, or `restore_output` from the connect body).
- `value` is the distance in **mm from the start of the measuring range** (0 to range_mm, slightly beyond is possible).
  The conversion follows the manual (p.85); it has not been checked against a reference distance yet.
- No target in range yields errors (`last_error`: 5/6 "peak before/after range", 4 "no peak", 10 "laser off") and `value: null`.
- The stream stops with `status: "error"` if no data arrives for 3 s.

## Not built yet (do not design UI around these)
- Real discovery. `/api/sensors/scan` returns the simulator plus USB serial ports it finds; ports are not probed.
- Multi-sensor mode (several sensors in one stream), additional output values (video, intensity, exposure time).
- MEDAQLib sensors (`ILD1420`, `ILD5500`, ...) are untested: the MEDAQLib DLL is Windows-only.
