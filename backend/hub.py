"""Single owner of the sensor. ONE thread touches the sensor; everything else goes through a queue."""
import asyncio, csv, json, os, queue, threading, time
from collections import deque
from concurrent.futures import Future
from datetime import datetime

from anomaly import AnomalyAgent
from sources import ERR_BASE, MedaqSource, ReplaySource, SerialSource, SimSource, ThermoSource, probe_port, serial_ports

REC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "recordings")
FRAME_S = 0.04          # UI frame interval (25 fps) - decimation: raw kHz stream never reaches the browser
WINDOW_S = 1.0          # stats window
ERR_NAMES = {1: "scaling underflow", 2: "scaling overflow", 3: "too much data for baudrate", 4: "no peak/edge",
             5: "peak before range", 6: "peak after range", 7: "cannot be calculated", 8: "global error",
             9: "peak too wide", 10: "laser off"}
DIST_EXTRAS = ("counter", "sensor_ts_ms", "intensity_pct", "shutter_us", "state")
FLOAT_FMT = {"sensor_ts_ms": 2, "intensity_pct": 2, "shutter_us": 1, "head_c": 3, "electronics_c": 3}
LED = {0: "off", 1: "green", 2: "red", 3: "yellow"}


def state_flags(st):
    """ILD1420 status word (manual p.86)."""
    if st is None:
        return None
    return {"peak_before_roi": bool(st & 1), "peak_after_roi": bool(st & 2), "no_peak": bool(st & 4),
            "before_smr": bool(st & 32), "after_emr": bool(st & 64), "triggered": bool(st & 32768),
            "led": LED[(st >> 16) & 3]}


def bucketize(points, t0, t1, bins):
    """[(t, v)] -> up to `bins` buckets of {t, min, max, mean} between t0 and t1 (for charts)."""
    w = max((t1 - t0) / bins, 1e-9)
    acc = {}
    for t, v in points:
        if t0 <= t <= t1:
            a = acc.setdefault(min(int((t - t0) / w), bins - 1), [v, v, 0.0, 0])
            a[0] = min(a[0], v); a[1] = max(a[1], v); a[2] += v; a[3] += 1
    return [{"t": t0 + (k + 0.5) * w, "min": a[0], "max": a[1], "mean": a[2] / a[3]} for k, a in sorted(acc.items())]


def _fmt(v, nd=6):
    return "" if v is None else (f"{v:.{nd}f}" if isinstance(v, float) else str(v))


class Hub:
    def __init__(self):
        self.cmds = queue.Queue()
        self.clients = set()
        self.bridge_clients = set()        # /ws/bridge: sensor-monitor website format
        self.loop = None
        self.status = "disconnected"       # disconnected | streaming | error
        self.error = ""
        self.src = None
        self.cfg = {}
        self.buf = deque(maxlen=400_000)   # (t, dist) valid readings only
        self.win = deque()                 # (t, dist or None) for the 1 s stats window
        self.wall_off = time.time() - time.perf_counter()
        self.rec = None
        self.rec_path = None
        self.rec_meta = None
        self.rec_count = 0
        self.rec_until = None
        self.tare = None
        self.ml = AnomalyAgent()           # anomaly agent: learns normal, flags the rest (anomaly.py)
        self._reset_counters()
        threading.Thread(target=self._run, daemon=True).start()

    def _reset_counters(self):
        self.total = 0
        self._last_total = 0
        self.rate_meas = 0.0
        self.err_total, self.last_err = 0, None
        self.dropped_total, self.last_counter = 0, None
        self.latest = {}
        self.last_frame = None
        self.int_sum, self.int_n = 0.0, 0

    # ---- called from the asyncio side -------------------------------------------------
    def call(self, fn, *a):
        fut = Future()
        self.cmds.put((fn, a, fut))
        return asyncio.wrap_future(fut)

    def state(self):
        return {"status": self.status, "error": self.error, "source": getattr(self.src, "kind", None),
                "info": getattr(self.src, "info", {}), "recording": self.rec is not None,
                "rec_file": os.path.basename(self.rec_path) if self.rec_path else None,
                "rec_samples": self.rec_count, "rec_label": (self.rec_meta or {}).get("label"),
                "rec_until_s": round(self.rec_until - time.perf_counter(), 1) if self.rec_until else None,
                "tare_mm": self.tare, "dropped_total": self.dropped_total, "cfg": self.cfg}

    # ---- sensor thread ----------------------------------------------------------------
    def _connect(self, cfg):
        self._disconnect()
        name = cfg.get("sensor", "SIM")
        if name.upper() == "AUTO":          # find the sensor: probe every USB serial port (or the given one), read-only
            found = None
            for port in ([cfg["port"]] if cfg.get("port") else serial_ports()):
                found = probe_port(port)
                if found:
                    break
            if not found:
                self.status, self.error = "error", "no sensor found on any USB serial port"
                raise RuntimeError(self.error)
            cfg = {**cfg, "sensor": found["sensor"], "port": found["port"]}
            name = found["sensor"]
        if name == "SIM":
            self.src = SimSource()
        elif name == "REPLAY":
            self.src = ReplaySource(REC_DIR)
        elif name.lower().startswith("thermo"):
            self.src = ThermoSource()
        elif name.endswith("-serial"):
            self.src = SerialSource()
        else:
            self.src = MedaqSource()
        try:
            self.src.open(cfg)
        except Exception as e:
            self.src, self.status, self.error = None, "error", str(e)
            raise
        self.cfg, self.status, self.error = cfg, "streaming", ""
        self.buf.clear(); self.win.clear(); self.tare = None
        self._reset_counters()
        self.ml.start(self.src.info, self.src.kind)
        return self.state()

    def _disconnect(self):
        self._stop_rec()
        if self.src:
            self.ml.stop()
            try:
                self.src.close()
            except Exception:
                pass
        self.src, self.status = None, "disconnected"
        return self.state()

    def _command(self, cmd, params):
        if not self.src:
            raise RuntimeError("not connected")
        try:
            return self.src.command(cmd, params or {})
        finally:
            self.win.clear(); self.last_counter = None     # the stream pauses for commands; that gap is not lost data

    def _settings(self):
        if not self.src or not hasattr(self.src, "settings"):
            raise RuntimeError("not connected or settings not supported for this source")
        return self.src.settings()

    def _apply(self, body):
        if not self.src or not hasattr(self.src, "apply"):
            raise RuntimeError("not connected or settings not supported for this source")
        try:
            out = self.src.apply(body)
            self.ml.reset(keep_labels=True)      # new sensor settings change the noise: learn the baseline again
            return out
        finally:
            self.win.clear(); self.last_counter = None     # also when the sensor rejected the change

    def _set_tare(self, on):
        if not on:
            self.tare = None
        else:
            ys = [v for _, v in self.win if v is not None]
            if not ys:
                raise RuntimeError("no valid reading to tare on (is a target in range?)")
            self.tare = sum(ys) / len(ys)
        return self.state()

    def _history(self, seconds, bins):
        """Last `seconds` of valid readings (tare applied), bucketed for chart prefill."""
        if not self.buf:
            return []
        t_end = self.buf[-1][0]
        off = self.tare or 0.0
        return bucketize(((t, v - off) for t, v in self.buf if t >= t_end - seconds), t_end - seconds, t_end, bins)

    # ---- anomaly agent (mutations run on this thread, like the sensor) -------------------
    def _ml_label(self, event_id, label, note):
        return self.ml.label(event_id, label, note)

    def _ml_reset(self, keep_labels):
        self.ml.reset(keep_labels)
        return self.ml.status()

    def _ml_config(self, body):
        return self.ml.set_config(body)

    def _ml_learn(self, info, feats, label="normal", note=""):
        def same(a, b):                    # "ILD1900" (older recordings) matches "ILD1900-10"
            a, b = str(a.get("model") or ""), str(b.get("model") or "")
            return bool(a) and (a == b or a.startswith(b + "-") or b.startswith(a + "-"))
        if not self.ml.key or not same(info, self.ml.info) or info.get("unit", "mm") != self.ml.unit:
            raise RuntimeError("connect the sensor this recording was made with first")
        return {"learned_windows": self.ml.learn_windows(feats, label, note), "label": label, **self.ml.status()}

    # ---- recording --------------------------------------------------------------------
    def _start_rec(self, label="", notes="", duration_s=None):
        if self.rec:
            return self.state()
        if self.status != "streaming":
            raise RuntimeError("connect a sensor first")
        os.makedirs(REC_DIR, exist_ok=True)
        self.rec_path = os.path.join(REC_DIR, datetime.now().strftime("rec_%Y%m%d_%H%M%S.csv"))
        self.rec = open(self.rec_path, "w", newline="")
        unit = (self.src.info or {}).get("unit", "mm")
        self.rec_extras = tuple(getattr(self.src, "CSV_EXTRAS", DIST_EXTRAS))
        cols = ["t_s", "wall_time", "temp_c" if unit == "°C" else "dist_mm", "error_code", *self.rec_extras]
        self.rec_w = csv.writer(self.rec); self.rec_w.writerow(cols); self.rec_count = 0
        settings = None
        try:
            settings = {k: v for k, v in self.src.settings().items() if k not in ("options", "raw")}
        except Exception:
            pass
        self.rec_meta = {"file": os.path.basename(self.rec_path), "label": label or "", "notes": notes or "",
                         "source": self.src.kind, "info": self.src.info, "settings": settings,
                         "unit": (self.src.info or {}).get("unit", "mm"),   # min_mm/max_mm/mean_mm are in this unit
                         "tare_mm": self.tare, "started": datetime.now().isoformat(timespec="seconds"),
                         "stopped": None, "duration_s": None, "samples": 0, "valid": 0, "errors": 0,
                         "errors_by_code": {}, "dropped": 0, "min_mm": None, "max_mm": None, "mean_mm": None,
                         "planned_duration_s": duration_s}
        self._rec_stats = {"t0": None, "t1": None, "sum": 0.0, "drop0": self.dropped_total}
        self.rec_until = time.perf_counter() + float(duration_s) if duration_s else None
        self._write_meta()
        return self.state()

    def _write_meta(self):
        with open(self.rec_path[:-4] + ".json", "w") as f:
            json.dump(self.rec_meta, f, indent=2)

    def _stop_rec(self):
        if self.rec:
            self.rec.close(); self.rec = None
            m, s = self.rec_meta, self._rec_stats
            m["stopped"] = datetime.now().isoformat(timespec="seconds")
            m["duration_s"] = round(s["t1"] - s["t0"], 3) if s["t0"] is not None else 0.0
            m["mean_mm"] = round(s["sum"] / m["valid"], 6) if m["valid"] else None
            m["dropped"] = self.dropped_total - s["drop0"]
            self._write_meta()
            self.rec_until = None
        return self.state()

    def _record(self, t, s, dist, code):
        m, st = self.rec_meta, self._rec_stats
        self.rec_w.writerow([f"{t:.6f}", f"{self.wall_off + t:.6f}", _fmt(dist), "" if code is None else code,
                             *(_fmt(s.get(k), FLOAT_FMT.get(k, 6)) for k in self.rec_extras)])
        self.rec_count += 1; m["samples"] += 1
        if st["t0"] is None:
            st["t0"] = t
        st["t1"] = t
        if code is None:
            m["valid"] += 1; st["sum"] += dist
            m["min_mm"] = dist if m["min_mm"] is None else min(m["min_mm"], dist)
            m["max_mm"] = dist if m["max_mm"] is None else max(m["max_mm"], dist)
        else:
            m["errors"] += 1
            m["errors_by_code"][str(code)] = m["errors_by_code"].get(str(code), 0) + 1

    # ---- main loop ----------------------------------------------------------------------
    def _run(self):
        last_frame, last_t = time.perf_counter(), time.perf_counter()
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
                samples = self.src.read()
            except Exception as e:
                self.status, self.error = "error", str(e); self._stop_rec(); continue

            now = time.perf_counter()
            if samples:
                rate = getattr(self.src, "rate_hz", 0)
                dt = 1.0 / rate if rate else (now - last_t) / len(samples)
                for i, s in enumerate(samples):
                    t = now - (len(samples) - 1 - i) * dt
                    v = s["dist"]
                    c = s.get("counter")
                    if c is not None and getattr(self.src, "kind", "") != "replay":   # a replay's gaps are old, and its loop restarts the counter
                        if self.last_counter is not None:
                            mod = getattr(self.src, "counter_mod", 262144)   # ILD: 18-bit, thermoMETER: 16-bit
                            gap = (c - self.last_counter - 1) % mod
                            if 0 < gap < mod // 2:
                                self.dropped_total += gap
                        self.last_counter = c
                    if "intensity_pct" in s:
                        self.int_sum += s["intensity_pct"]; self.int_n += 1
                    if v <= -1e9:       # sensor error code, not a distance: count it, keep it out of chart/stats
                        code = int(round(ERR_BASE - v)); self.err_total += 1
                        self.last_err = {"code": code, "text": ERR_NAMES.get(code, "unknown error")}
                        self.win.append((t, None))
                        self.ml.feed(t, None, s, self.dropped_total, self.wall_off)
                        if self.rec:
                            self._record(t, s, None, code)
                        continue
                    self.buf.append((t, v)); self.win.append((t, v))
                    self.ml.feed(t, v, s, self.dropped_total, self.wall_off)
                    if self.rec:
                        self._record(t, s, v, None)
                self.latest = samples[-1]
                self.total += len(samples)
            last_t = now
            while self.win and now - self.win[0][0] > WINDOW_S:
                self.win.popleft()
            if self.rec and self.rec_until and now >= self.rec_until:
                self._stop_rec()

            if now - last_frame >= FRAME_S and self.win:
                span = now - last_frame
                self.rate_meas = 0.8 * self.rate_meas + 0.2 * ((self.total - self._last_total) / span)
                last_frame, self._last_total = now, self.total
                ys = [v for _, v in self.win if v is not None]
                bad = len(self.win) - len(ys)
                off = self.tare or 0.0
                last_valid = ys[-1] if ys else None
                lt = self.latest
                info = dict(getattr(self.src, "info", {}) or {})
                smr = info.get("smr_mm")
                frame = {"t": now, "source": self.src.kind, "info": info,
                         "value": None if last_valid is None else last_valid - off,
                         "min": min(ys) - off if ys else None, "max": max(ys) - off if ys else None,
                         "mean": sum(ys) / len(ys) - off if ys else None,
                         "n": len(ys), "errors_in_window": bad, "last_error": self.last_err,
                         "rate_hz": round(self.rate_meas), "status": self.status,
                         "recording": self.rec is not None, "rec_samples": self.rec_count,
                         "dist_from_face_mm": None if last_valid is None or smr is None else last_valid + smr,
                         "tare_mm": self.tare,
                         "intensity": round(self.int_sum / self.int_n, 2) if self.int_n else None,
                         "shutter_us": lt.get("shutter_us"), "counter": lt.get("counter"),
                         "sensor_ts_ms": lt.get("sensor_ts_ms"), "state": lt.get("state"),
                         "state_flags": state_flags(lt.get("state")), "dropped_total": self.dropped_total,
                         "current_valid": lt.get("dist", ERR_BASE) > -1e9,
                         "unit": (getattr(self.src, "info", {}) or {}).get("unit", "mm"),
                         "raw_value": last_valid,                       # latest valid reading, tare NOT applied
                         "head_c": lt.get("head_c"), "electronics_c": lt.get("electronics_c"),
                         "ml": self.ml.frame()}
                self.int_sum, self.int_n = 0.0, 0
                self.last_frame = frame
                if self.loop and (self.clients or self.bridge_clients):
                    self.loop.call_soon_threadsafe(self._broadcast, frame, self.bridge_message(frame))

    LEDS = ("green", "yellow", "red", "off")

    def bridge_message(self, f):
        """The message format of the sensor-monitor website's 'local sensor bridge' (frontend/dist/app.js connectBridge):
        value (mm from the sensor face, or °C), unit, sensor, state (status LED) and output (output LED). No-target frames have
        value null and current_valid false so clients can distinguish invalid measurements from a lost connection.
        Source and measuring-window metadata let clients validate the connected sensor."""
        info = getattr(self.src, "info", None) or {}
        smr, rng = info.get("smr_mm"), info.get("range_mm")
        led = (f.get("state_flags") or {}).get("led")
        unit = info.get("unit", "mm")
        reading = f.get("dist_from_face_mm") if unit == "mm" else f.get("raw_value")   # distance: from the sensor face
        valid = f.get("current_valid") and reading is not None
        return {"value": round(reading, 4) if valid else None, "unit": unit, "sensor": info.get("model"),
                "current_valid": bool(valid),
                "state": led if led in self.LEDS else "unknown",
                "output": "green" if f.get("status") == "streaming" else "unknown",
                "source": getattr(self.src, "kind", None), "info": dict(info),   # e.g. serial-ild1900 (live) or replay
                "serial": info.get("serial"), "range_start": smr, "range_end": None if smr is None or rng is None else smr + rng,
                "range": rng, "rate_hz": f.get("rate_hz"), "intensity": f.get("intensity"),
                "error": None if valid else (f.get("last_error") or {}).get("text") or "no valid reading",
                "dropped_total": f.get("dropped_total"), "t": f.get("t"), "ml": f.get("ml")}

    def _broadcast(self, frame, bridge_msg):
        for ws in list(self.clients):
            asyncio.ensure_future(self._send(ws, frame, self.clients))
        for ws in list(self.bridge_clients):
            asyncio.ensure_future(self._send(ws, bridge_msg, self.bridge_clients))

    async def _send(self, ws, payload, group):
        try:
            await ws.send_json(payload)
        except Exception:
            group.discard(ws)
