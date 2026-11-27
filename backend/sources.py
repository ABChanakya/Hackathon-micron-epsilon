"""Data sources. All expose the same small interface so the hub doesn't care which is used.

    open(cfg) / close() / read() -> list[dict] (blocks briefly) / command(cmd, params) -> str
    settings() -> dict / apply(body) -> dict          (optional)

Each sample is a dict. "dist" is always present: distance in mm, or ERR_BASE - code for an invalid reading
(MEDAQLib convention, MEDAQLib.pdf p.135). Optional extras: counter, sensor_ts_ms, intensity_pct, shutter_us, state.
"""
import contextlib, csv, json, math, os, random, re, time

ERR_BASE = -1e10
EXTRA_KEYS = ("counter", "sensor_ts_ms", "intensity_pct", "shutter_us", "state")

SERIAL_OPTIONS = {"rate_khz": [0.25, 0.5, 1, 2, 4, 8],
                  "averaging": {"NONE": [], "MOVING": [2, 4, 8, 16, 32, 64, 128],
                                "RECURSIVE": "2..32767", "MEDIAN": [3, 5, 7, 9]},
                  "channels": ["COUNTER", "INTENSITY", "STATE", "TIMESTAMP", "SHUTTER"]}

# Start of measuring range from the sensor face, ILD1420 by measuring range (manual p.16)
ILD1420_SMR_MM = {10: 20, 25: 25, 50: 35, 100: 50, 200: 60, 500: 100}


ILD1900_SMR_MM = {10: 20, 25: 25, 50: 40, 100: 50, 200: 60, 500: 100}   # ILD1900 manual p.18
ILD1900_OPTIONS = {"rate_khz": [0.25, 0.5, 1, 2, 4, 8, 10],            # 7 steps, manual p.18 (0.25-10 kHz)
                   "averaging": {"NONE": [], "MOVING": [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096],
                                 "RECURSIVE": "2..32767", "MEDIAN": [3, 5, 7, 9]},
                   "channels": SERIAL_OPTIONS["channels"]}


def _check_avg(a, options=None):
    opts = (options or SERIAL_OPTIONS)["averaging"]
    mode = str(a.get("mode", "NONE")).upper()
    if mode == "NONE":
        return {"mode": "NONE", "depth": None}
    depth = int(a.get("depth", 0))
    ok = {"MOVING": depth in opts["MOVING"], "RECURSIVE": 2 <= depth <= 32767,
          "MEDIAN": depth in opts["MEDIAN"]}.get(mode)
    if not ok:
        raise RuntimeError(f"invalid averaging {mode} {depth}; options: {opts}")
    return {"mode": mode, "depth": depth}


def _check_channels(ch):
    ch = [str(c).upper() for c in ch]
    bad = [c for c in ch if c not in SERIAL_OPTIONS["channels"]]
    if bad:
        raise RuntimeError(f"unknown channels {bad}; options: {SERIAL_OPTIONS['channels']}")
    return [c for c in SERIAL_OPTIONS["channels"] if c in ch]     # canonical (priority) order


class SimSource:
    """Fake ILD1420-50: slow sine + noise in mm, with counter/timestamp/intensity and occasional errors."""
    kind = "sim"

    def __init__(self):
        self.rate_hz = 2000.0
        self._t0 = time.perf_counter()
        self._n = 0
        self.avg = {"mode": "MEDIAN", "depth": 9}
        self.channels = list(SERIAL_OPTIONS["channels"])
        self.info = {"model": "SIM-ILD1420-50", "serial": "SIM-0001", "range_mm": 50.0, "smr_mm": 35, "unit": "mm"}

    def open(self, cfg):
        self._t0, self._n = time.perf_counter(), 0

    def close(self):
        pass

    def read(self):
        time.sleep(0.02)
        due = int((time.perf_counter() - self._t0) * self.rate_hz)
        out = []
        for i in range(self._n, due):
            t = i / self.rate_hz
            err = random.random() < 0.001          # ~0.1% invalid readings, like a real sensor ('no peak')
            s = {"dist": ERR_BASE - 4 if err else 25 + 10 * math.sin(2 * math.pi * 0.5 * t) + random.gauss(0, 0.015)}
            if "COUNTER" in self.channels:
                s["counter"] = i % 262144
            if "TIMESTAMP" in self.channels:
                s["sensor_ts_ms"] = round(t * 1000, 2)
            if "INTENSITY" in self.channels:
                s["intensity_pct"] = 0.0 if err else round(55 + 5 * math.sin(2 * math.pi * 0.1 * t), 2)
            if "SHUTTER" in self.channels:
                s["shutter_us"] = 496.1
            if "STATE" in self.channels:
                s["state"] = (4 | (2 << 16)) if err else (1 << 16)    # no peak + red LED / green LED
            out.append(s)
        self._n = due
        return out

    def command(self, cmd, params):
        if cmd == "Set_Samplerate" and "SP_Measrate" in params:
            self.rate_hz = float(params["SP_Measrate"]) * 1000.0  # kHz like the real SP_Measrate
        return "OK (simulated)"

    def settings(self):
        return {"rate_khz": self.rate_hz / 1000.0, "averaging": self.avg, "channels": self.channels,
                "channels_active": self.channels, "options": SERIAL_OPTIONS}

    def apply(self, body):
        if "rate_khz" in body:
            khz = float(body["rate_khz"])
            if khz not in SERIAL_OPTIONS["rate_khz"]:
                raise RuntimeError(f"rate_khz must be one of {SERIAL_OPTIONS['rate_khz']}")
            self.rate_hz = khz * 1000.0
        if "averaging" in body:
            self.avg = _check_avg(body["averaging"])
        if "channels" in body:
            self.channels = _check_channels(body["channels"])
        return self.settings()


class MedaqSource:
    """Real sensor through MEDAQLib (see MEDAQLib.pdf section 4). Windows/Linux only, untested."""
    kind = "medaqlib"

    def __init__(self):
        self.obj = None
        self.per_frame = 1
        self.rate_hz = 0.0
        self.info = {}

    @staticmethod
    def _load():
        # MEDAQLib.py loads the DLL from os.getcwd() AT IMPORT TIME -> chdir first.
        here = os.path.dirname(os.path.abspath(__file__))
        libdir = os.environ.get("MEDAQLIB_DIR", os.path.join(here, "..", "software", "MEDAQLib_samples"))
        libdir = os.path.abspath(libdir)
        old = os.getcwd()
        os.chdir(libdir)
        try:
            import importlib.util
            spec = importlib.util.spec_from_file_location("MEDAQLib_mod", os.path.join(libdir, "MEDAQLib.py"))
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            return mod
        finally:
            os.chdir(old)

    def open(self, cfg):
        m = self._load()
        self.m = m
        self.obj = m.MEDAQLib.CreateSensorInstByName(cfg["sensor"])  # e.g. "ILD1420"
        lines = [f"IP_Interface={cfg.get('interface', 'RS232')}"]
        if cfg.get("port"):
            lines.append(f"IP_Port={cfg['port']}")
        if cfg.get("baudrate"):
            lines.append(f"IP_Baudrate={cfg['baudrate']}")
        if cfg.get("ip"):
            lines.append(f"IP_RemoteAddr={cfg['ip']}")
        self.obj.SetParameters("\n".join(lines))
        self.obj.SetParameterInt("IP_EnableLogging", 1)
        self.obj.OpenSensor()
        if self.obj.GetLastError() != m.ERR_CODE.ERR_NOERROR:
            raise RuntimeError(self.obj.GetError())
        try:  # how many values per frame (multi-signal sensors)
            self.obj.ExecSCmd("Get_TransmittedDataInfo")
            self.per_frame = max(1, self.obj.GetParameterInt("IA_ValuesPerFrame"))
        except Exception:
            self.per_frame = 1
        self.info = {"model": cfg["sensor"], "serial": "?", "unit": "mm"}

    def close(self):
        if self.obj:
            try:
                self.obj.CloseSensor()
                self.obj.ReleaseSensorInstance()
            finally:
                self.obj = None

    def read(self):
        n = self.obj.DataAvail()
        if n <= 0:
            time.sleep(0.005)
            return []
        raw, scaled, cnt = self.obj.TransferData(n)
        if self.obj.GetLastError() != self.m.ERR_CODE.ERR_NOERROR:
            raise RuntimeError(self.obj.GetError())
        return [{"dist": v} for v in scaled[0:cnt:self.per_frame]]  # first signal of each frame

    def command(self, cmd, params):
        for k, v in (params or {}).items():
            if isinstance(v, bool) or isinstance(v, int):
                self.obj.SetParameterInt(k, int(v))
            elif isinstance(v, float):
                self.obj.SetParameterDouble(k, v)
            else:
                self.obj.SetParameterString(k, str(v))
        self.obj.ExecSCmd(cmd)
        if self.obj.GetLastError() != self.m.ERR_CODE.ERR_NOERROR:
            raise RuntimeError(self.obj.GetError())
        try:  # SA_* answers / full answer dump (also handy for the Get_Setup diff trick)
            return self.obj.GetParameters(10000)
        except Exception:
            return "OK"


class SerialSource:
    """optoNCDT ILD1420 and ILD1900 straight over their RS422/USB serial line (pyserial, no MEDAQLib -> works on macOS).
    The model is read from GETINFO and picks the profile (commands and scaling differ, see _scale/_sample/_set_channels).
    Protocol: ILD1420 manual ch. 8 + appendix A3, ILD1900 manual ch. 8, 7.6.2 and A3.2. ASCII commands end with CRLF
    and are answered with '...\r\n->'.
    Measurement values are 3-byte words (flag bits 00 L / 01 M / 10|11 H, 6 data bits each). A frame starts with
    an H flag of 10; the following words (H flag 11) come in the order reported by GETOUTINFO_RS422
    (verified: SHUTTER COUNTER TIMESTAMPLO TIMESTAMPHI INTENSITY1 DIST1 STATE)."""
    kind = "serial-ild1420"
    # 18-bit distance codes >= 262075 (manual p.86) -> MEDAQLib-style error code (see hub.ERR_NAMES)
    ERR_MAP = {262075: 3, 262076: 4, 262077: 5, 262078: 6, 262080: 8, 262081: 9, 262082: 10}
    MEASRATES = tuple(SERIAL_OPTIONS["rate_khz"])
    WORDS = {"COUNTER": 1, "INTENSITY": 1, "STATE": 1, "TIMESTAMP": 2, "SHUTTER": 1}
    BUDGET = 26000      # words/s: 921600 baud / 10 bits / 3 bytes = 30720, keep ~15% margin

    def __init__(self):
        self.ser = None
        self.buf = bytearray()
        self.rate_hz = 2000.0
        self.range_mm = 50.0
        self.info = {}
        self.restore = None
        self.restore_add = None
        self.wanted = list(SERIAL_OPTIONS["channels"])
        self.channels = []
        self.order = ["DIST1"]
        self.cur = None
        self.unsupported = set()      # rates this unit rejected (E236)
        self.is1900 = False           # profile: False = ILD1420, True = ILD1900
        self.options = SERIAL_OPTIONS
        self.print_text = ""
        self.avg = {"mode": "NONE", "depth": None}
        self._last_rx = 0.0

    # ---- ASCII command channel ---------------------------------------------------------
    def _ascii(self, line, wait=1.0):
        """Send a command while data may be streaming. A reply is text ending in '->'. Valid binary words are
        L(0x00-3F) M(0x40-7F) H(0x80-BF), so the text is the run of bytes before '->' back to the last H byte."""
        self.ser.write(line.encode() + b"\r\n")
        end = time.time() + wait
        got = bytearray(self.buf); self.buf.clear()
        while time.time() < end:
            got += self.ser.read(max(self.ser.in_waiting, 1))
            if got.find(b"->") >= 0:
                break
        j = got.find(b"->")
        if j < 0:
            self.buf += got
            return ""
        i = j
        while i > 0 and got[i - 1] < 0x80:
            i -= 1
        text = got[i:j].decode("latin1").strip()
        self.buf += got[:i] + got[j + 2:]          # everything around the reply is still binary data
        return text

    def _ok(self, line, wait=1.0):
        ans = self._ascii(line, wait)
        if re.match(r"E\d+", ans):
            raise RuntimeError(f"{line}: {ans}")
        return ans

    @contextlib.contextmanager
    def _paused(self):
        """Stop the RS422 stream while changing settings. The sensor keeps streaming while it answers commands,
        so with several values per sample the reply text gets interleaved with binary data (seen on hardware)."""
        if getattr(self, "_pause_depth", 0):
            yield; return
        self._pause_depth = 1
        try:
            self.ser.write(b"OUTPUT NONE\r\n")
            # Drain until its '->' arrived and the line is quiet; a late prompt would shift every later reply by one.
            end, last, seen, tail = time.time() + 2.0, time.time(), False, b""
            while time.time() < end:
                d = self.ser.read(4096)
                now = time.time()
                if d:
                    last, tail = now, (tail + d)[-64:]
                    seen = seen or b"->" in tail
                elif seen and now - last > 0.15:
                    break
            self.buf.clear(); self.cur = None
            yield
        finally:
            self._pause_depth = 0
            try:
                self._ascii("OUTPUT RS422")
            finally:
                self._last_rx = time.time()

    def _fit(self, wanted, rate_hz):
        """Drop lowest-priority channels until all words fit the RS422 bandwidth at this rate."""
        ch = _check_channels(wanted)
        while ch and (1 + sum(self.WORDS[c] for c in ch)) * rate_hz > self.BUDGET:
            ch.pop()
        return ch

    WIRE_1900 = {"SHUTTER": "SHUTTER", "COUNTER": "COUNTER", "TIMESTAMP": "TIMESTAMP_LO TIMESTAMP_HI",
                 "INTENSITY": "INTENSITY", "STATE": "STATE"}

    @staticmethod
    def _norm(name):
        """Signal names differ per model (TIMESTAMP_LO vs TIMESTAMPLO, INTENSITY vs INTENSITY1)."""
        n = name.replace("_", "")
        return "INTENSITY1" if n == "INTENSITY" else n

    def _set_channels(self, channels):
        if self.is1900:
            self._ok("OUT_RS422 DIST1" + "".join(" " + self.WIRE_1900[c] for c in channels))
        else:
            self._ok("OUTADD_RS422 " + (" ".join(channels) if channels else "NONE"))
        info = self._ascii("GETOUTINFO_RS422")
        order = [self._norm(n) for n in info.split()[1:]] if info.startswith("GETOUTINFO_RS422") else []
        if "DIST1" not in order:
            raise RuntimeError(f"unexpected GETOUTINFO_RS422 reply: {info!r}")
        self.channels, self.order, self.cur = channels, order, None
        self.buf.clear()

    def open(self, cfg):
        import serial
        port = cfg.get("port")
        if not port:
            raise RuntimeError("port required, e.g. /dev/cu.usbserial-000101")
        self.ser = serial.Serial(port, int(cfg.get("baudrate") or 921600), timeout=0.02)
        try:
            self.ser.write(b"\r\n"); time.sleep(0.3); self.ser.reset_input_buffer()   # absorbs the stray first-write error
            self.buf.clear()
            txt = self._ascii("GETINFO")
            if "Name:" not in txt:
                raise RuntimeError(f"no ILD answer on {port} at {self.ser.baudrate} baud (got {txt!r})")
            kv = dict(l.split(":", 1) for l in txt.splitlines() if ":" in l)
            kv = {k.strip(): v.strip() for k, v in kv.items()}
            name = kv.get("Name", "")
            if name.startswith("ILD1900"):
                self.is1900, self.options, self.kind = True, ILD1900_OPTIONS, "serial-ild1900"
            elif name.startswith("ILD1420"):
                self.is1900, self.options, self.kind = False, SERIAL_OPTIONS, "serial-ild1420"
            else:
                raise RuntimeError(f"unsupported sensor {name!r}: this driver knows ILD1420 and ILD1900")
            self.MEASRATES = tuple(self.options["rate_khz"])
            m = float(kv.get("Measuring range", "50").lower().replace("mm", "").strip() or 50)
            self.range_mm = m
            smr = (ILD1900_SMR_MM if self.is1900 else ILD1420_SMR_MM).get(int(m))
            self.info = {"model": name, "serial": kv.get("Serial"), "range_mm": m, "smr_mm": smr,
                         "firmware": kv.get("Version"), "unit": "mm"}
            mo = re.search(r"OUTPUT\s+(\w+)", self._ascii("OUTPUT"))   # remember the output mode to restore on close
            prev = mo.group(1) if mo else "ANALOG"
            self.restore = cfg.get("restore_output") or ("ANALOG" if prev == "RS422" else prev)
            if prev == "RS422":                                    # stream active: silence it so PRINT is clean text
                self._ascii("OUTPUT ANALOG"); time.sleep(0.2); self.ser.reset_input_buffer(); self.buf.clear()
            self.print_text = self._ascii("PRINT", wait=2.0)
            self.snapshot = dict(re.findall(r"^(\w+)[ \t]+(.*?)\s*$", self.print_text, re.M))
            if self.is1900:     # e.g. "COMP CH01 1 MEDIAN DIST1 9" (averaging block 1) and "OUT_RS422 DIST1"
                ma = re.search(r"^COMP CH01 1 (\w+)(?: \S+ (\d+))?", self.print_text, re.M)
                self.avg = {"mode": ma.group(1), "depth": int(ma.group(2)) if ma and ma.group(2) else None} if ma else self.avg
                self.restore_add = self.snapshot.get("OUT_RS422", "DIST1")
            else:
                a = self.snapshot.get("AVERAGE", "NONE").split()
                self.avg = {"mode": a[0], "depth": int(a[1]) if len(a) > 1 else None}
                self.restore_add = self.snapshot.get("OUTADD_RS422", "NONE")
            # Remember what the sensor had BEFORE we touched it until we have put it back. If an earlier session died
            # (cable pulled, crash), the values read now are our own leftovers, so the marker's values win.
            self._marker = os.path.join(os.path.dirname(os.path.abspath(__file__)), f".sensor_state_{self.info['serial']}.json")
            if os.path.isfile(self._marker):
                try:
                    with open(self._marker) as f:
                        m = json.load(f)
                    self.restore = cfg.get("restore_output") or m.get("output", self.restore)
                    self.restore_add = m.get("add", self.restore_add)
                except Exception:
                    pass
            else:
                with open(self._marker, "w") as f:
                    json.dump({"output": self.restore, "add": self.restore_add}, f)
            mr = re.search(r"MEASRATE\s+([\d.]+)", self.snapshot.get("MEASRATE", "") and "MEASRATE " + self.snapshot["MEASRATE"])
            if mr:
                self.rate_hz = float(mr.group(1)) * 1000.0
            if cfg.get("channels") is not None:
                self.wanted = _check_channels(cfg["channels"])
            self._set_channels(self._fit(self.wanted, self.rate_hz))  # sensor idle: clean replies
            self._ascii("OUTPUT RS422")
            self._last_rx = time.time()
        except Exception:
            self.close()
            raise

    def close(self):
        if self.ser:
            restored = False
            try:
                if self.restore:
                    self._ascii(f"OUTPUT {self.restore}", wait=0.8)   # stop the stream first ...
                    time.sleep(0.2); self.ser.reset_input_buffer(); self.buf.clear()
                if self.restore_add is not None:   # ... then restore the data selection the sensor had
                    cmd = "OUT_RS422" if self.is1900 else "OUTADD_RS422"
                    self._ascii(f"{cmd} {self.restore_add}", wait=0.8)
                restored = True
            except Exception:
                pass                                # e.g. the USB cable was pulled; the marker file keeps the original
            try:
                self.ser.close()
            finally:
                self.ser = None
            if restored and getattr(self, "_marker", None) and os.path.isfile(self._marker):
                os.remove(self._marker)

    # ---- measurement channel -----------------------------------------------------------
    def _scale(self, x):
        """18-bit word -> mm from the start of the measuring range, or ERR_BASE - code for an invalid reading."""
        if self.is1900:
            if x >= 262073:
                return ERR_BASE - self.ERR_MAP.get(x, 7)
            return (x - 98232) / 65536.0 * self.range_mm              # ILD1900 manual p.79
        if x >= 262075 or x > 65520:
            return ERR_BASE - self.ERR_MAP.get(x, 7)
        return (102.0 / 65520.0 * x - 1.0) * self.range_mm / 100.0   # ILD1420 manual p.85

    def _sample(self, words):
        """Map one frame (raw words in GETOUTINFO order) to a sample dict using the formulas on manual p.85-86."""
        v = dict(zip(self.order, words))
        s = {"dist": self._scale(v["DIST1"])}
        if "COUNTER" in v:
            s["counter"] = v["COUNTER"]
        if "TIMESTAMPLO" in v and "TIMESTAMPHI" in v:
            t = 65536 * v["TIMESTAMPHI"] + v["TIMESTAMPLO"]
            s["sensor_ts_ms"] = t / 1000.0 if self.is1900 else t / 100.0   # ILD1900: microseconds, ILD1420: 0.01 ms
        if "INTENSITY1" in v:
            s["intensity_pct"] = round(v["INTENSITY1"] * (100.0 / 1023.0 if self.is1900 else 25.0 / 16368.0), 2)
        if "SHUTTER" in v:
            s["shutter_us"] = v["SHUTTER"] / 10.0
        if "STATE" in v:
            s["state"] = v["STATE"]
        return s

    def read(self):
        self.buf += self.ser.read(max(self.ser.in_waiting, 1))
        b, out, i, n, size = self.buf, [], 0, len(self.buf), len(self.order)
        while i + 2 < n:
            if b[i] >> 6 == 0 and b[i + 1] >> 6 == 1 and b[i + 2] >> 6 >= 2:
                w = (b[i] & 63) | (b[i + 1] & 63) << 6 | (b[i + 2] & 63) << 12
                if b[i + 2] >> 6 == 2:          # first word of a frame (an incomplete previous frame is dropped)
                    self.cur = [w]
                elif self.cur is not None:
                    self.cur.append(w)
                if self.cur is not None and len(self.cur) == size:
                    out.append(self._sample(self.cur)); self.cur = None
                i += 3
            else:
                i += 1
        del b[:i]
        now = time.time()
        if out:
            self._last_rx = now
        elif now - self._last_rx > 3:
            raise RuntimeError("no data from sensor for 3 s (output not RS422, cable or power?)")
        return out

    def settings(self):
        sn = getattr(self, "snapshot", {})            # PRINT is read once while the sensor is idle; kept in sync by apply()
        return {"rate_khz": self.rate_hz / 1000.0, "averaging": self.avg, "channels": self.wanted,
                "channels_active": self.channels, "order": self.order, "raw": sn,
                "options": dict(self.options, rate_khz=[r for r in self.options["rate_khz"] if r not in self.unsupported])}

    def _set_rate(self, khz):
        if khz not in self.MEASRATES:
            raise RuntimeError(f"MEASRATE must be one of {self.MEASRATES} kHz")
        new = khz * 1000.0
        fit = self._fit(self.wanted, new)
        try:
            if new > self.rate_hz:                   # shrink the frame before speeding up, so it never overflows
                self._set_channels(fit); self._ok(f"MEASRATE {khz:g}")
            else:
                self._ok(f"MEASRATE {khz:g}"); self._set_channels(fit)
        except RuntimeError as e:
            self._set_channels(self._fit(self.wanted, self.rate_hz))   # back to the channel set of the old rate
            if "E236" in str(e):
                self.unsupported.add(khz)
                raise RuntimeError(f"sensor rejected {khz:g} kHz (E236); this unit's limit is lower (laser class 1 "
                                   f"ILD1420 models stop at 4 kHz, manual p.16). Rate stays {self.rate_hz / 1000:g} kHz.") from None
            raise
        self.rate_hz = new
        self.snapshot["MEASRATE"] = f"{khz:.3f}"

    def apply(self, body):
        wanted = _check_channels(body["channels"]) if "channels" in body else None   # validate before touching the sensor
        avg = _check_avg(body["averaging"], self.options) if "averaging" in body else None
        if "rate_khz" in body and float(body["rate_khz"]) not in self.MEASRATES:
            raise RuntimeError(f"MEASRATE must be one of {self.MEASRATES} kHz")
        with self._paused():
            if wanted is not None:
                self.wanted = wanted
                if "rate_khz" not in body:
                    self._set_channels(self._fit(self.wanted, self.rate_hz))
            if "rate_khz" in body:
                self._set_rate(float(body["rate_khz"]))
            if avg is not None:
                if self.is1900:     # averaging block 1 on channel CH01, applied to the distance signal
                    line = "COMP CH01 1 NONE" if avg["mode"] == "NONE" else f"COMP CH01 1 {avg['mode']} DIST1 {avg['depth']}"
                else:
                    line = "AVERAGE NONE" if avg["mode"] == "NONE" else f"AVERAGE {avg['mode']} {avg['depth']}"
                self._ok(line)
                self.avg = avg
                self.snapshot["AVERAGE"] = line[8:]
        return self.settings()

    def command(self, cmd, params):
        with self._paused():
            if cmd == "Set_Samplerate":
                self._set_rate(float(params.get("SP_Measrate")))
                return "OK"
            line = cmd if not params or "args" not in params else f"{cmd} {params['args']}"
            return self._ascii(line)   # raw ASCII command, e.g. {"cmd":"AVERAGE","params":{"args":"MEDIAN 9"}}


class ReplaySource:
    """Plays a recording back through the normal pipeline, paced by its t_s column, so the UI works without hardware."""
    kind = "replay"

    def __init__(self, rec_dir):
        self.rec_dir = rec_dir
        self.info = {}
        self.rate_hz = 0.0

    def open(self, cfg):
        name = os.path.basename(cfg.get("file") or "")
        path = os.path.join(self.rec_dir, name)
        if not name.endswith(".csv") or not os.path.isfile(path):
            raise RuntimeError(f"recording not found: {name!r} (see /api/recordings)")
        self.speed = float(cfg.get("speed") or 1.0)
        self.loop = cfg.get("loop", True) is not False
        self.ts, self.samples = [], []
        with open(path, newline="") as f:
            for row in csv.DictReader(f):
                try:
                    t = float(row["t_s"])
                except (KeyError, ValueError):
                    continue
                d = row.get("dist_mm", row.get("value", ""))
                code = row.get("error_code") or (d[3:] if d.startswith("ERR") else "")
                if code:
                    s = {"dist": ERR_BASE - int(code)}
                elif d:
                    s = {"dist": float(d)}
                else:
                    continue
                for k in EXTRA_KEYS:
                    if row.get(k) not in (None, ""):
                        s[k] = float(row[k]) if k in ("sensor_ts_ms", "intensity_pct", "shutter_us") else int(float(row[k]))
                self.ts.append(t); self.samples.append(s)
        if not self.samples:
            raise RuntimeError(f"recording {name} has no samples")
        t0 = self.ts[0]
        self.ts = [t - t0 for t in self.ts]
        dur = self.ts[-1]
        self.rate_hz = (len(self.ts) - 1) / dur if dur > 0 else 1000.0
        meta = {}
        side = path[:-4] + ".json"
        if os.path.isfile(side):
            with open(side) as f:
                meta = json.load(f)
        self.meta = meta
        self.info = dict(meta.get("info") or {"model": "recording", "unit": "mm"})
        self.info.update({"replay_of": name, "label": meta.get("label", ""), "duration_s": round(dur, 3)})
        self._start, self._i = time.perf_counter(), 0

    def close(self):
        pass

    def read(self):
        time.sleep(0.02)
        el = (time.perf_counter() - self._start) * self.speed
        out = []
        while self._i < len(self.ts) and self.ts[self._i] <= el:
            out.append(self.samples[self._i]); self._i += 1
        if self._i >= len(self.ts) and self.loop:
            self._start, self._i = time.perf_counter(), 0
        return out

    def settings(self):
        st = self.meta.get("settings") or {}
        return {"rate_khz": round(self.rate_hz / 1000.0, 3), "averaging": st.get("averaging"),
                "channels": st.get("channels_active", []), "channels_active": st.get("channels_active", []),
                "options": {}, "replay": {"file": self.info.get("replay_of"), "speed": self.speed, "loop": self.loop}}

    def apply(self, body):
        if "speed" in body:
            el = (time.perf_counter() - self._start) * self.speed
            self.speed = max(0.05, float(body["speed"]))
            self._start = time.perf_counter() - el / self.speed
        if "loop" in body:
            self.loop = bool(body["loop"])
        return self.settings()

    def command(self, cmd, params):
        raise RuntimeError("commands are not available while replaying a recording")
