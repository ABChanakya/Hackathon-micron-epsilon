"""Short reviewed paraphrases, not complete manuals or a runtime retrieval index.

Only the known application's sensor IDs select hardware facts. Source URLs are
fixed reviewed constants, never taken from user input or generated model text.
References use the printed page numbers (also the PDF's one-based page numbers).
"""
from copy import deepcopy


SENSOR_SOURCES = [
    {
        "id": "manual:optoncdt1900",
        "title": "optoNCDT 1900 / ILD1900-10 — Operating Instructions",
        "url": "https://www.micro-epsilon.de/fileadmin/download/manuals/man--optoNCDT-1900--en.pdf",
        "models": ["ILD1900-10"],
        "reference": "§3.1 p.16; §5.1.1–5.1.2 pp.25–28; §7.4.8 p.69; §A3.4 pp.131–132",
        "retrievedAt": "2026-11-28",
    },
    {
        "id": "manual:thermometer-uc",
        "title": "thermoMETER UC / UC-SF22-S3 — Betriebsanleitung",
        "url": "https://www.micro-epsilon.de/fileadmin/download/manuals/man--thermoMETER-UC--de.pdf",
        "models": ["UC-SF22-S1", "UC-SF22-S3", "UC-SF22-S8", "UC-SF22-S15"],
        "reference": "§2.1–2.2 p.7; §4.1 p.10; §10 p.33; §11.1–11.3 p.34",
        "retrievedAt": "2026-11-28",
    },
]

_FACTS_BY_SENSOR = {
    "ild1900": """Reviewed manual: optoNCDT 1900, applicable here to ILD1900-10.
Optical triangulation derives distance from the position of the reflected light
spot on a CMOS receiver. The diffuse reflection is evaluated. Surface colour,
reflectivity, roughness, target angle and interfering light can influence readings.
For uncertain readings, ask about the observed surface and optical conditions;
these are possible influences, not proof of a defective sensor. Depending on the
configured error processing, an invalid measurement can produce an error value
or repeat the last valid value; the configuration is unknown unless supplied.
The manual separately lists command errors. App guard: INVALID_SIGNAL is an app
status, not a manufacturer error number. Do not invent a device code or infer
hardware failure from it. Do not change exposure, laser, wiring or hardware.
Source: manual:optoncdt1900; references and retrieval date accompany the source.""",
    "thermo_uc": """Reviewed manual: thermoMETER UC, applicable here to UC-SF22 variants.
This non-contact infrared sensor derives surface temperature from emitted
infrared radiation. The object should fill the optical field of view; the spot
size depends on measurement distance. Emissivity describes material radiation
behaviour. Surface condition and measurement angle affect it; reflective surfaces
with low emissivity can admit disturbing background radiation. For implausible
temperatures, ask about object coverage, material, surface and the supplied
emissivity setting; do not assume or automatically alter that setting. App guard:
INVALID_SIGNAL or a disconnected app does not identify a manufacturer error code
or prove sensor damage. Ask for the actual device message if one exists.
Do not issue wiring, cleaning or hardware-setting instructions.
Source: manual:thermometer-uc; references and retrieval date accompany the source.""",
}

SENSOR_FACTS = "\n\n".join(_FACTS_BY_SENSOR.values())
_SOURCE_BY_SENSOR = {"ild1900": 0, "thermo_uc": 1}


def _sensor_id(sensor):
    if isinstance(sensor, str):
        return sensor
    if isinstance(sensor, dict):
        return sensor.get("id")
    return getattr(sensor, "id", None)


def facts_for(sensor):
    """Return only reviewed facts for the known sensor ID; unknown means none."""
    return _FACTS_BY_SENSOR.get(_sensor_id(sensor), "")


def sources_for(sensor):
    """Return isolated copies so a response cannot mutate trusted source metadata."""
    index = _SOURCE_BY_SENSOR.get(_sensor_id(sensor))
    return [] if index is None else [deepcopy(SENSOR_SOURCES[index])]
