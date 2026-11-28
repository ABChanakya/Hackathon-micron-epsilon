"""Device check: which kind of device is behind the connected source, and which UI may show it.

One place decides this for every client (desktop monitor, phone view, pitch page, scripts). The backend adds the result
as `device` to /api/status, to every frame of /ws/stream and /ws/bridge, and serves it at GET /api/device. A UI shows a
device only when `verified` is true and its `family` is one the UI has elements for; everything else (unknown device,
inconsistent data) is rejected before any value reaches the UI elements.

`family`    ild1900 | ild1420 | thermo_uc | unknown
`measures`  distance | temperature | null   (decides the layout: mm gauge and 3D sensor, or a °C reading)
`origin`    hardware (a real sensor), simulator, replay (a recording), unknown
`live`      true only for origin hardware: real, current measurements
`verified`  the model, unit and measuring window all agree with the family's known data sheet values
"""
import re

# family -> data sheet values the reported info must match
FAMILIES = {
    "ild1900": {"label": "optoNCDT ILD1900-10", "measures": "distance", "unit": "mm", "range_mm": 10, "smr_mm": 20},
    "ild1420": {"label": "optoNCDT ILD1420-50", "measures": "distance", "unit": "mm", "range_mm": 50, "smr_mm": 35},
    "thermo_uc": {"label": "thermoMETER UC", "measures": "temperature", "unit": "°C", "range_min": -50, "range_max": 900},
}
HARDWARE = {"serial-ild1420", "serial-ild1900", "thermo-uc", "medaqlib", "ethernet-ild1900", "ethernet-ild1420"}
ORIGIN = {"sim": "simulator", "replay": "replay"}
UI = {  # which UI elements exist for a layout
    "distance": {"layout": "distance", "gauge_unit": "mm", "sensor_3d": True, "leds": True},
    "temperature": {"layout": "temperature", "gauge_unit": "°C", "sensor_3d": False, "leds": False},
}


def _code(text):
    return re.sub(r"[^a-z0-9]", "", str(text or "").lower())


def _family(model):
    c = _code(model)
    c = c[3:] if c.startswith("sim") else c          # the simulator imitates a real model: SIM-ILD1900-10
    if c.startswith(("ild1900", "optoncdt1900")):
        return "ild1900"
    if c.startswith(("ild1420", "optoncdt1420")):
        return "ild1420"
    if c.startswith("ucsf") or c.startswith("thermometeruc"):
        return "thermo_uc"
    return "unknown"


def identify(source, info):
    """Describe and check the device behind `source` (a source kind like "serial-ild1900") and its `info` dict."""
    info = info or {}
    origin = "hardware" if source in HARDWARE else ORIGIN.get(source, "unknown")
    family = _family(info.get("model"))
    problems = []
    spec = FAMILIES.get(family)
    if family == "unknown":
        problems.append(f"unknown device model: {info.get('model') or 'none reported'}")
    else:
        if info.get("unit") != spec["unit"]:
            problems.append(f"unit {info.get('unit')!r} does not fit {spec['label']} ({spec['unit']})")
        for key in ("range_mm", "smr_mm", "range_min", "range_max"):
            want = spec.get(key)
            if want is not None and key in info and info[key] != want:
                problems.append(f"{key} {info[key]} does not fit {spec['label']} ({want})")
        if spec["measures"] == "distance" and "range_mm" not in info:
            problems.append("measuring range not reported")
    # a real sensor must also come through the matching driver
    if origin == "hardware" and family != "unknown":
        ok = {"ild1900": ("serial-ild1900", "medaqlib", "ethernet-ild1900"),
              "ild1420": ("serial-ild1420", "medaqlib", "ethernet-ild1420"),
              "thermo_uc": ("thermo-uc", "medaqlib")}[family]
        if source not in ok:
            problems.append(f"source {source} does not fit {spec['label']}")
    verified = family != "unknown" and not problems
    measures = spec["measures"] if spec else None
    return {"family": family, "label": spec["label"] if spec else None, "measures": measures,
            "unit": spec["unit"] if spec else info.get("unit"), "model": info.get("model"), "serial": info.get("serial"),
            "origin": origin, "live": origin == "hardware" and verified, "verified": verified, "problems": problems,
            "ui": UI.get(measures) if verified else None}
