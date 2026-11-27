"""Single owner of the sensor. ONE thread touches MEDAQLib; everything else goes through a queue."""
import asyncio, csv, os, queue, threading, time
from collections import deque
from concurrent.futures import Future
from datetime import datetime

from sources import MedaqSource, SerialSource, SimSource

REC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "recordings")
FRAME_S = 0.04          # UI frame interval (25 fps) - decimation: raw kHz stream never reaches the browser
WINDOW_S = 1.0          # stats window
ERR_BASE = -1e10        # MEDAQLib NegativeErrorOffset: invalid readings arrive as ERR_BASE - code (MEDAQLib.pdf p.135)
ERR_NAMES = {1: "scaling underflow", 2: "scaling overflow", 3: "too much data for baudrate", 4: "no peak/edge",
             5: "peak before range", 6: "peak after range", 7: "cannot be calculated", 8: "global error",
             9: "peak too wide", 10: "laser off"}


class Hub:
    def __init__(self):
        self.cmds = queue.Queue()
        self.clients = set()
        self.loop = None
        self.status = "disconnected"       # disconnected | streaming | error
        self.error = ""
        self.src = None
        self.cfg = {}
        self.buf = deque(maxlen=400_000)   # (t, value)
        self.win = deque()
        self.rec = None
        self.rec_path = None
        self.rec_count = 0
        self.total = 0
        self.rate_meas = 0.0
        self.err_total, self.last_err = 0, None
        threading.Thread(target=self._run, daemon=True).start()

    # ---- called from the asyncio side -------------------------------------------------
    def call(self, fn, *a):
        fut = Future()
        self.cmds.put((fn, a, fut))
        return asyncio.wrap_future(fut)

    def state(self):
        return {"status": self.status, "error": self.error, "source": getattr(self.src, "kind", None),
                "info": getattr(self.src, "info", {}), "recording": self.rec is not None,
                "rec_file": os.path.basename(self.rec_path) if self.rec_path else None,
                "rec_samples": self.rec_count, "cfg": self.cfg}

    # ---- sensor thread ----------------------------------------------------------------
    def _connect(self, cfg):
        self._disconnect()
        name = cfg.get("sensor", "SIM")
        self.src = SimSource() if name == "SIM" else SerialSource() if name.endswith("-serial") else MedaqSource()
        try:
            self.src.open(cfg)
        except Exception as e:
            self.src, self.status, self.error = None, "error", str(e)
            raise
        self.cfg, self.status, self.error = cfg, "streaming", ""
        self.buf.clear(); self.win.clear(); self.total = 0; self.err_total, self.last_err = 0, None
        return self.state()

    def _disconnect(self):
        self._stop_rec()
        if self.src:
            try:
                self.src.close()
            except Exception:
                pass
        self.src, self.status = None, "disconnected"
        return self.state()

    def _command(self, cmd, params):
        if not self.src:
            raise RuntimeError("not connected")
        out = self.src.command(cmd, params or {})
        if hasattr(self.src, "rate_hz") and cmd == "Set_Samplerate":
            self.win.clear()
        return out

    def _start_rec(self):
        if self.rec:
            return self.state()
        os.makedirs(REC_DIR, exist_ok=True)
        self.rec_path = os.path.join(REC_DIR, datetime.now().strftime("rec_%Y%m%d_%H%M%S.csv"))
        self.rec = open(self.rec_path, "w", newline="")
        self.rec_w = csv.writer(self.rec); self.rec_w.writerow(["t_s", "value"]); self.rec_count = 0
        return self.state()

    def _stop_rec(self):
        if self.rec:
            self.rec.close(); self.rec = None
        return self.state()

    def _run(self):
        last_frame, last_total, last_t = time.perf_counter(), 0, time.perf_counter()
        while True:
            try:
                while True:
                    fn, a, fut = self.cmds.get_nowait()
                    try:
                        fut.set_result(getattr(self, fn)(*a))
                    except Exception as e:
                        fut.set_exception(e)
            except queue.Empty:
                pass

            if self.status != "streaming" or not self.src:
                time.sleep(0.05); continue
            try:
                vals = self.src.read()
            except Exception as e:
                self.status, self.error = "error", str(e); self._stop_rec(); continue

            now = time.perf_counter()
            if vals:
                dt = 1.0 / max(self.src.rate_hz, 1.0) if getattr(self.src, "rate_hz", 0) else (now - last_t) / len(vals)
                for i, v in enumerate(vals):
                    t = now - (len(vals) - 1 - i) * dt
                    if v <= -1e9:       # sensor error code, not a distance: count it, keep it out of chart/stats/CSV value
                        code = int(round(ERR_BASE - v)); self.err_total += 1
                        self.last_err = {"code": code, "text": ERR_NAMES.get(code, "unknown error")}
                        self.win.append((t, None))
                        if self.rec:
                            self.rec_w.writerow([f"{t:.6f}", f"ERR{code}"]); self.rec_count += 1
                        continue
                    self.buf.append((t, v)); self.win.append((t, v))
                    if self.rec:
                        self.rec_w.writerow([f"{t:.6f}", f"{v:.6f}"]); self.rec_count += 1
                self.total += len(vals)
            last_t = now
            while self.win and now - self.win[0][0] > WINDOW_S:
                self.win.popleft()

            if now - last_frame >= FRAME_S and self.win:
                span = now - last_frame
                self.rate_meas = 0.8 * self.rate_meas + 0.2 * ((self.total - last_total) / span)
                last_frame, last_total = now, self.total
                ys = [v for _, v in self.win if v is not None]
                bad = len(self.win) - len(ys)
                if not ys:
                    ys = [float("nan")]
                nan = ys[-1] != ys[-1]
                frame = {"t": now, "value": None if nan else ys[-1], "min": None if nan else min(ys), "max": None if nan else max(ys),
                         "mean": None if nan else sum(ys) / len(ys),
                         "n": 0 if nan else len(ys), "errors_in_window": bad, "last_error": self.last_err, "rate_hz": round(self.rate_meas), "status": self.status,
                         "recording": self.rec is not None, "rec_samples": self.rec_count}
                if self.loop and self.clients:
                    self.loop.call_soon_threadsafe(self._broadcast, frame)

    def _broadcast(self, frame):
        for ws in list(self.clients):
            asyncio.ensure_future(self._send(ws, frame))

    async def _send(self, ws, frame):
        try:
            await ws.send_json(frame)
        except Exception:
            self.clients.discard(ws)
