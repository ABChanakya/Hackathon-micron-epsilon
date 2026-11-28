"""Reviewed app facts, derived from frontend/dist/app.js and data.js; no hardware manual."""

SOURCES = [
    {"id": "app:operation", "title": "Sensor Cockpit: Quellen, Anzeige und Einstellungen"},
    {"id": "app:measurements", "title": "App-Vertrag: Nullpunkt, Zeitfenster und Trends"},
    {"id": "app:storage", "title": "App-Vertrag: lokale Profile, Aufzeichnungen und Export"},
    {"id": "app:assistant", "title": "Assistent: Vorschläge ohne Parameteranwendung"},
]

FACTS = """
Verified application facts (not a sensor manual):
- Sensor Cockpit shows distance in mm or temperature in °C, as supplied by the context.
  Sensor, demo and replay are different data sources. A pause or invalid/disconnected
  signal can leave historical curves visible; it does not make them current data.
- Settings contain display/language, connection, measurement profile and anomaly settings.
  Sensor setup and connection help are available there. No attached device is required
  for explaining the interface. Unknown hardware specifications must not be invented.
- A display zero point subtracts zeroOffset from displayed values. It does not change
  absolute recorded measurements or the profile's absolute limits. The chart summary
  min/max/mean/trend are on this displayed, zero-adjusted basis. context.value and
  profile lower/upper/target are absolute. summary.outside was calculated from absolute
  samples against absolute specification limits. Do not compare relative values to
  absolute limits without adding zeroOffset.
- summary.trend is the last-section mean minus the first-section mean, in mm or °C;
  it is NOT a derivative per second. The separate slope graph is a one-second trend
  of measurement samples in mm/s or °C/s. No inclination channel is available.
- start/end/eventTime are seconds on the measurement timeline, NOT Unix timestamps.
  capturedAt is the snapshot's creation time; lastValidAt is the last valid sample time.
  paused/connected/valid must be considered when discussing the current reading.
- Profiles and browser recordings are local to this browser. Local deletion does not
  delete server recordings or ML models. The last successful local deletion can be
  undone until reload or the next successful deletion. CSV/PDF export is available;
  local storage errors must never be described as successful saves.
- Browser evaluation-limit learning and server anomaly detection are separate mechanisms.
  The server's statistical anomaly model is not this language model. Specification
  limits remain separate from learned evaluation limits.
- Parameter commands may only propose lower, upper or target of a browser profile.
  They never apply values, send raw device commands, change a laser or alter hardware.
  Confirmation is a simulation. The server has no authoritative browser profile store.
""".strip()
