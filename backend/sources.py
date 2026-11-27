"""Data sources. Both expose the same tiny interface so the hub doesn't care which is used.

    open(cfg) / close() / read() -> list[float] (blocks briefly) / command(cmd, params) -> str
"""
import math, os, random, time


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
