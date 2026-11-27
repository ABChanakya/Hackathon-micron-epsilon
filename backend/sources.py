"""Data sources. Both expose the same tiny interface so the hub doesn't care which is used.

    open(cfg) / close() / read() -> list[float] (blocks briefly) / command(cmd, params) -> str
"""
import math, os, random, re, time


class SimSource:
    """Fake sensor: sine + noise. Lets the UI be built and demoed without hardware."""
    kind = "sim"

    def __init__(self):
        self.rate_hz = 2000.0
        self._t0 = time.perf_counter()
        self._n = 0
        self.info = {"model": "SIM-ILD1420", "serial": "SIM-0001", "range_mm": 25.0, "unit": "µm"}

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
            # ~0.1% of samples mimic a sensor error (-1e10 - 4 = 'no peak'), like the real MEDAQLib scaled output
            out.append(-1e10 - 4 if random.random() < 0.001 else 12500 + 4000 * math.sin(2 * math.pi * 0.5 * t) + random.gauss(0, 15))
        self._n = due
        return out

    def command(self, cmd, params):
        if cmd == "Set_Samplerate" and "SP_Measrate" in params:
            self.rate_hz = float(params["SP_Measrate"]) * 1000.0  # kHz like the real SP_Measrate
        return "OK (simulated)"


class MedaqSource:
    """Real sensor through MEDAQLib (see MEDAQLib.pdf section 4)."""
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
        return list(scaled[0:cnt:self.per_frame])  # first signal of each frame

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
    """optoNCDT ILD1420 straight over its RS422/USB serial line (pyserial, no MEDAQLib -> works on macOS).
    Protocol: ILD1420 manual ch. 8 + appendix A3. ASCII commands end with CRLF and are answered with '...\r\n->';
    measurement values are 3-byte binary frames (flag bits 00 L / 01 M / 10|11 H, 6 data bits each)."""
    kind = "serial-ild1420"
    ERR_BASE = -1e10   # same convention as MEDAQLib so hub.py treats errors uniformly
    # 18-bit distance codes >= 262075 (manual p.86) -> MEDAQLib-style error code (see hub.ERR_NAMES)
    ERR_MAP = {262075: 3, 262076: 4, 262077: 5, 262078: 6, 262080: 8, 262081: 9, 262082: 10}
    MEASRATES = (0.25, 0.5, 1, 2, 4, 8)

    def __init__(self):
        self.ser = None
        self.buf = bytearray()
        self.rate_hz = 2000.0
        self.range_mm = 50.0
        self.info = {}
        self.restore = None
        self._last_rx = 0.0

    # ---- ASCII command channel ---------------------------------------------------------
    def _ascii(self, line, wait=1.0):
        """Send a command while data may be streaming. A reply is text ending in '->'. Valid binary frames are
        L(0x00-3F) M(0x40-7F) H(0x80-BF), so the text is the run of bytes before '->' back to the last H byte."""
        import time as _t
        self.ser.write(line.encode() + b"\r\n")
        end = _t.time() + wait
        got = bytearray(self.buf); self.buf.clear()
        while _t.time() < end:
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

    def open(self, cfg):
        import serial, time as _t
        port = cfg.get("port")
        if not port:
            raise RuntimeError("port required, e.g. /dev/cu.usbserial-000101")
        self.ser = serial.Serial(port, int(cfg.get("baudrate") or 921600), timeout=0.02)
        try:
            self.ser.write(b"\r\n"); _t.sleep(0.3); self.ser.reset_input_buffer()   # absorbs the stray first-write error
            self.buf.clear()
            txt = self._ascii("GETINFO")
            if "Name:" not in txt:
                raise RuntimeError(f"no ILD1420 answer on {port} at {self.ser.baudrate} baud (got {txt!r})")
            kv = dict(l.split(":", 1) for l in txt.splitlines() if ":" in l)
            kv = {k.strip(): v.strip() for k, v in kv.items()}
            m = float(kv.get("Measuring range", "50").lower().replace("mm", "").strip() or 50)
            self.range_mm = m
            self.info = {"model": kv.get("Name"), "serial": kv.get("Serial"), "range_mm": m,
                         "firmware": kv.get("Version"), "unit": "mm"}
            mo = re.search(r"OUTPUT\s+(\w+)", self._ascii("OUTPUT"))   # remember the output mode to restore on close
            prev = mo.group(1) if mo else "ANALOG"
            self.restore = cfg.get("restore_output") or ("ANALOG" if prev == "RS422" else prev)
            self._ascii("OUTPUT RS422")
            mr = re.search(r"MEASRATE\s+([\d.]+)", self._ascii("MEASRATE"))
            if mr:
                self.rate_hz = float(mr.group(1)) * 1000.0
            self._last_rx = _t.time()
        except Exception:
            self.close()
            raise

    def close(self):
        if self.ser:
            try:
                if self.restore:
                    self._ascii(f"OUTPUT {self.restore}", wait=0.8)
            except Exception:
                pass
            try:
                self.ser.close()
            finally:
                self.ser = None

    # ---- measurement channel -----------------------------------------------------------
    def _scale(self, x):
        if x >= 262075 or x > 65520:
            return self.ERR_BASE - self.ERR_MAP.get(x, 7)
        return (102.0 / 65520.0 * x - 1.0) * self.range_mm / 100.0   # mm from start of measuring range (manual p.85)

    def read(self):
        import time as _t
        self.buf += self.ser.read(max(self.ser.in_waiting, 1))
        b, out, i, n = self.buf, [], 0, len(self.buf)
        while i + 2 < n:
            if b[i] >> 6 == 0 and b[i + 1] >> 6 == 1 and b[i + 2] >> 6 >= 2:
                if b[i + 2] >> 6 == 2:    # value 1 only (OUTADD_RS422 is NONE); 11 = additional values, skipped
                    out.append(self._scale((b[i] & 63) | (b[i + 1] & 63) << 6 | (b[i + 2] & 63) << 12))
                i += 3
            else:
                i += 1
        del b[:i]
        now = _t.time()
        if out:
            self._last_rx = now
        elif now - self._last_rx > 3:
            raise RuntimeError("no data from sensor for 3 s (output not RS422, cable or power?)")
        return out

    def command(self, cmd, params):
        if cmd == "Set_Samplerate":
            khz = float(params.get("SP_Measrate"))
            if khz not in self.MEASRATES:
                raise RuntimeError(f"MEASRATE must be one of {self.MEASRATES} kHz")
            ans = self._ascii(f"MEASRATE {khz:g}")
            self.rate_hz = khz * 1000.0
            return ans or "OK"
        line = cmd if not params or "args" not in params else f"{cmd} {params['args']}"
        return self._ascii(line)   # raw ASCII command, e.g. {"cmd":"AVERAGE","params":{"args":"MEDIAN 9"}}
