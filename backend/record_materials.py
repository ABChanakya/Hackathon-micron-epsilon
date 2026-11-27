#!/usr/bin/env python3
"""Record test materials with the connected sensor, one material after the other. Run it in a terminal:

    cd backend
    python3 record_materials.py              # real sensor (found automatically)
    python3 record_materials.py --sensor SIM # practice run without a sensor

For every material it asks for the name, waits until you have placed it, checks that the sensor sees it and that it
holds still, then records two takes (the sensor's median averaging, and no averaging). Recordings land in
backend/recordings/ and show up in the UI's recordings list. Only the Python standard library is needed.
Press Ctrl+C at any time: the sensor is put back the way it was.
"""
import argparse, glob, json, os, subprocess, sys, time, urllib.error, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
started_server = None


# ---- small API client -------------------------------------------------------------------------
def api(base, path, body=None, method=None, timeout=20):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, data=data, method=method or ("POST" if data is not None else "GET"),
                                 headers={"content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        try:
            detail = json.loads(e.read()).get("detail", "")
        except Exception:
            detail = ""
        raise RuntimeError(detail or f"HTTP {e.code} on {path}") from None


def server_up(base):
    try:
        api(base, "/api/status", timeout=2)
        return True
    except Exception:
        return False


def start_server(base):
    global started_server
    port = base.rsplit(":", 1)[1].split("/")[0]
    py = os.path.join(HERE, ".venv", "bin", "python")
    py = py if os.path.exists(py) else sys.executable
    log = open(os.path.join(HERE, "server.log"), "w")
    started_server = subprocess.Popen([py, "-m", "uvicorn", "app:app", "--port", port], cwd=HERE, stdout=log, stderr=subprocess.STDOUT)
    for _ in range(40):
        if server_up(base):
            return
        if started_server.poll() is not None:
            break
        time.sleep(0.5)
    raise SystemExit("Could not start the backend (see backend/server.log). Is fastapi installed? "
                     "Run: python3 -m venv .venv && .venv/bin/pip install -r requirements.txt")


def stop_server():
    if started_server and started_server.poll() is None:
        started_server.terminate()           # the backend's shutdown hook puts the sensor back first
        try:
            started_server.wait(timeout=10)
        except subprocess.TimeoutExpired:
            started_server.kill()


# ---- helpers ------------------------------------------------------------------------------------
def ask(prompt):
    try:
        return input(prompt).strip()
    except EOFError:
        return ""


def connect(base, cfg):
    try:
        api(base, "/api/disconnect", {})
    except Exception:
        pass
    return api(base, "/api/connect", cfg)


def ensure_streaming(base, cfg):
    st = api(base, "/api/status")
    if st["status"] != "streaming":
        print(f"  (sensor connection lost: {st.get('error') or st['status']}. Reconnecting...)")
        connect(base, cfg)
        time.sleep(1.0)


def snapshot(base, n=6, gap=0.25):
    """A few live frames -> (last frame, distances seen). Raises if the stream is silent."""
    frames = []
    for _ in range(n):
        f = api(base, "/api/latest")
        if f:
            frames.append(f)
        time.sleep(gap)
    if not frames:
        raise RuntimeError("no live data from the backend")
    vals = [f["value"] for f in frames if f.get("value") is not None]
    return frames[-1], vals


def wait_ready(base, cfg, name, lo, hi):
    """Loop until the material is in range and still. Returns False if the user wants to skip it."""
    while True:
        ans = ask(f"\n  Place '{name}' flat, {lo:g} to {hi:g} mm from the sensor face, hold it still, then press Enter "
                  f"(s = skip this material): ")
        if ans.lower() == "s":
            return False
        ensure_streaming(base, cfg)
        try:
            f, vals = snapshot(base)
        except RuntimeError as e:
            print(f"  ! {e}")
            continue
        if not vals:
            err = (f.get("last_error") or {}).get("text", "no target")
            print(f"  ! The sensor sees no target ({err}). Check the distance ({lo:g}-{hi:g} mm from the face) and try again.")
            continue
        spread_um = (max(vals) - min(vals)) * 1000
        face = f.get("dist_from_face_mm")
        print(f"  Target found: {face:.2f} mm from the face, intensity {f.get('intensity')}%, LED {(f.get('state_flags') or {}).get('led')}, "
              f"spread over 1.5 s: {spread_um:.1f} um" if face is not None else f"  Target found, spread {spread_um:.1f} um")
        if spread_um > 50:
            ans = ask("  ! It is moving. Hold it still and press Enter to check again, or type g to record anyway: ")
            if ans.lower() != "g":
                continue
        for i in (3, 2, 1):
            print(f"  Recording in {i}...", end="\r", flush=True)
            time.sleep(1)
        return True


def record_take(base, cfg, name, tag, avg, rate, seconds):
    ensure_streaming(base, cfg)
    api(base, "/api/settings", {"rate_khz": rate, "averaging": avg})
    time.sleep(1.0)
    r = api(base, "/api/record/start", {"label": f"{name} | {tag}", "duration_s": seconds,
                                        "notes": f"material: {name}; {rate:g} kHz; {tag}; static"})
    file = r["rec_file"]
    t0 = time.time()
    while True:
        st = api(base, "/api/status")
        if not st["recording"] or time.time() - t0 > seconds + 8:
            break
        left = max(0, seconds - (time.time() - t0))
        print(f"  {tag:14} recording... {left:4.1f} s left, {st['rec_samples']} samples   ", end="\r", flush=True)
        time.sleep(0.25)
    if st["recording"]:
        api(base, "/api/record/stop", {})
    time.sleep(0.3)
    meta = next((m for m in api(base, "/api/recordings") if m["file"] == file), None)
    return file, meta


def fmt(meta):
    if not meta or not meta.get("samples"):
        return "no data"
    valid = 100.0 * meta["valid"] / meta["samples"]
    p2p = "-" if meta["min_mm"] is None else f"{(meta['max_mm'] - meta['min_mm']) * 1000:.1f} um"
    mean = "-" if meta["mean_mm"] is None else f"{meta['mean_mm']:.4f} mm"
    return f"{meta['samples']} samples, {valid:.1f}% valid, {meta['dropped']} dropped, mean {mean}, spread {p2p}"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--api", default="http://localhost:8000", help="backend address (started automatically if not running)")
    ap.add_argument("--sensor", default="auto", help="auto (find the USB serial port) or SIM for a practice run")
    ap.add_argument("--port", help="serial port, e.g. /dev/cu.usbserial-010720 (default: found automatically)")
    ap.add_argument("--seconds", type=float, default=10, help="length of each take (default 10)")
    ap.add_argument("--rate", type=float, default=4, help="measuring rate in kHz (default 4)")
    ap.add_argument("--takes", default="median,none", help="comma list of: median, none, moving (default median,none)")
    a = ap.parse_args()
    base = a.api.rstrip("/")
    avg_of = {"median": ("median 9", {"mode": "MEDIAN", "depth": 9}), "none": ("no averaging", {"mode": "NONE"}),
              "moving": ("moving 16", {"mode": "MOVING", "depth": 16})}
    takes = [avg_of[t] for t in a.takes.split(",") if t in avg_of]
    if not takes:
        raise SystemExit("--takes needs at least one of: median, none, moving")

    if a.sensor.upper() == "SIM":
        cfg = {"sensor": "SIM"}
    else:
        ports = [a.port] if a.port else sorted(glob.glob("/dev/cu.usbserial*") + glob.glob("/dev/ttyUSB*"))
        if not ports:
            raise SystemExit("No USB serial port found. Plug the sensor in (and check the cable), or use --sensor SIM to practise.")
        port = ports[0]
        if len(ports) > 1:
            for i, p in enumerate(ports, 1):
                print(f"  {i}. {p}")
            port = ports[int(ask(f"Which port is the sensor [1-{len(ports)}]? ") or 1) - 1]
        cfg = {"sensor": "ILD-serial", "port": port}

    results, original = [], None
    try:
        if not server_up(base):
            print("Starting the backend...")
            start_server(base)
        info = connect(base, cfg)["info"]
        original = api(base, "/api/settings")
        lo = info.get("smr_mm") or 0
        hi = lo + (info.get("range_mm") or 0)
        print(f"\nConnected: {info.get('model')}, serial {info.get('serial')}, measuring range {lo:g}-{hi:g} mm from the sensor face.")
        print(f"Each material gets {len(takes)} take(s) of {a.seconds:g} s at {a.rate:g} kHz. "
              f"While this runs the sensor's analog output is off.")
        while True:
            name = ask("\nMaterial name (just press Enter when you are finished): ")
            if not name:
                break
            if not wait_ready(base, cfg, name, lo, hi):
                continue
            for tag, avg in takes:
                while True:
                    file, meta = record_take(base, cfg, name, tag, avg, a.rate, a.seconds)
                    print(f"  {tag:14} done: {fmt(meta)}" + " " * 12)
                    bad = (not meta) or meta["samples"] == 0 or meta["valid"] < 0.9 * meta["samples"]
                    if bad:
                        ans = ask("  ! Less than 90% valid readings: was the material in range and still? "
                                  "Press Enter to record this take again, or k to keep it: ")
                        if ans.lower() != "k":
                            try:
                                api(base, f"/api/recordings/{file}", method="DELETE")
                            except Exception:
                                pass
                            continue
                    results.append((name, tag, file, meta))
                    break
            print(f"  '{name}' finished.")
    except KeyboardInterrupt:
        print("\nStopped by you.")
    except (RuntimeError, urllib.error.URLError) as e:
        print(f"\nError: {e}")
    finally:
        try:
            if api(base, "/api/status")["recording"]:
                api(base, "/api/record/stop", {})
            if original:
                api(base, "/api/settings", {"rate_khz": original["rate_khz"], "averaging": original["averaging"]})
            api(base, "/api/disconnect", {})
        except Exception:
            pass
        stop_server()

    print("\n==== Session summary ====")
    if not results:
        print("No recordings were made.")
    for name, tag, file, meta in results:
        print(f"{name} | {tag}\n    {file}: {fmt(meta)}")
    if results:
        print(f"\nFiles are in {os.path.join(HERE, 'recordings')}  (CSV + .json with the details).")
    print("The sensor has been set back to how it was." if original else "")


if __name__ == "__main__":
    main()
