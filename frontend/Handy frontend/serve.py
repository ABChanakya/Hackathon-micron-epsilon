"""Serve the mobile monitor and relay three read-only endpoints to the local backend."""

import argparse
import json
from functools import partial
from http.client import HTTPConnection, HTTPException
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


FRONTEND = Path(__file__).resolve().parent.parent / "dist"
LOCALE_FILES = {f"{code}.js" for code in ("en", "fr", "es", "it", "cs", "zh", "ja", "ko", "pirate")}
LOCALE_FILES.update({"cockpit-copy.js", "settings-copy.js", "mobile-copy.js", "coverage-copy.js", "recordings-copy.js"})
SHARED_FILES = {"/i18n.js": FRONTEND / "i18n.js", "/factory-copy.js": FRONTEND / "factory-copy.js", **{f"/locales/{name}": FRONTEND / "locales" / name for name in LOCALE_FILES}}

DATA_ENDPOINTS = {"/api/status", "/api/latest", "/api/device"}


class MonitorHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, backend_port, **kwargs):
        self.backend_port = backend_port
        super().__init__(*args, directory=str(Path(__file__).resolve().parent), **kwargs)

    def send_payload(self, payload, content_type):
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/monitor-config.json":
            return self.send_payload(json.dumps({"backendPort": self.backend_port}).encode(), "application/json; charset=utf-8")
        if path in SHARED_FILES:
            try:
                payload = SHARED_FILES[path].read_bytes()
            except OSError:
                return self.send_error(404, "Shared language file not found")
            return self.send_payload(payload, "text/javascript; charset=utf-8")
        if path not in DATA_ENDPOINTS:
            return super().do_GET()

        connection = HTTPConnection("127.0.0.1", self.backend_port, timeout=2)
        try:
            connection.request("GET", path)
            reply = connection.getresponse()
            if reply.status != 200:
                self.send_error(502, "Sensor backend did not return data")
                return
            payload = reply.read()
        except (OSError, HTTPException):
            self.send_error(502, "Sensor backend is unreachable")
            return
        finally:
            connection.close()

        self.send_payload(payload, "application/json; charset=utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bind", default="0.0.0.0")
    parser.add_argument("--port", default=4174, type=int)
    parser.add_argument("--backend-port", default=8000, type=int)
    args = parser.parse_args()
    if not 1 <= args.port <= 65535 or not 1 <= args.backend_port <= 65535:
        parser.error("Port numbers must be between 1 and 65535.")
    if args.port == args.backend_port:
        parser.error("The mobile server and sensor backend need different ports.")

    handler = partial(MonitorHandler, backend_port=args.backend_port)
    with ThreadingHTTPServer((args.bind, args.port), handler) as server:
        print(f"Mobiler Messplatz auf Port {args.port}, Sensor-Backend auf 127.0.0.1:{args.backend_port}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
