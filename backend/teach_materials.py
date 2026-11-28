"""Teach the anomaly agent the material recordings: every recording of the connected sensor is learned as normal,
except the ones whose label contains an anomaly word (default: "black-metal"), which are learned as anomaly.

Run while the server runs and the sensor (or a replay of one of its recordings) is connected:
    .venv/bin/python teach_materials.py                      # black metal = anomaly
    .venv/bin/python teach_materials.py --anomaly black-metal --anomaly phone
    .venv/bin/python teach_materials.py --fresh              # forget what was learned and taught before
Only the standard library is used.
"""
import argparse, json, urllib.error, urllib.request


def call(base, method, path, body=None):
    req = urllib.request.Request(base + path, method=method, headers={"content-type": "application/json"},
                                 data=None if body is None else json.dumps(body).encode())
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{method} {path}: {e.code} {json.loads(e.read() or b'{}').get('detail', '')}")


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--server", default="http://127.0.0.1:8000")
    ap.add_argument("--anomaly", action="append", help="label text of anomaly recordings (repeatable)")
    ap.add_argument("--fresh", action="store_true", help="forget the learned baseline and all labels first")
    a = ap.parse_args()
    words = [w.lower() for w in (a.anomaly or ["black-metal"])]

    st = call(a.server, "GET", "/api/ml")
    if not st.get("sensor"):
        raise SystemExit("Connect the sensor first (monitor: Sensor verbinden), or a replay of one of its recordings.")
    if a.fresh:
        call(a.server, "POST", "/api/ml/reset", {"keep_labels": False})
    model = st["sensor"]
    same = lambda m: bool(m) and (m == model or m.startswith(model + "-") or model.startswith(m + "-"))
    recs = [r for r in call(a.server, "GET", "/api/recordings") if same((r.get("info") or {}).get("model"))]
    if not recs:
        raise SystemExit(f"No recordings of {model} in backend/recordings.")
    for r in sorted(recs, key=lambda r: r["file"]):
        label = "anomaly" if any(w in (r.get("label") or "").lower() for w in words) else "normal"
        out = call(a.server, "POST", "/api/ml/learn", {"file": r["file"], "label": label})
        print(f"{label:8s} {out['learned_windows']:3d} windows  {r.get('label') or r['file']}")
    st = call(a.server, "GET", "/api/ml")
    print(f"\n{model}: {st['baseline_windows']} normal windows, {st['anomaly_examples']} anomaly examples. State: {st['state']}")


if __name__ == "__main__":
    main()
