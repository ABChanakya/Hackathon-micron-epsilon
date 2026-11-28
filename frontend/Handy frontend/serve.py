"""Serve the mobile monitor and relay the local sensor's read-only data."""

import argparse
import base64
import errno
import ipaddress
import json
import os
import select
import signal
import socket
import sys
import threading
from contextlib import contextmanager
from functools import partial
from http.client import HTTPConnection, HTTPException, parse_headers
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4


PHONE = Path(__file__).resolve().parent
FRONTEND = PHONE.parent / "dist"
DEFAULT_PORT = 4174
LOCALE_FILES = {f"{code}.js" for code in ("en", "fr", "es", "it", "cs", "zh", "ja", "ko", "pirate")}
LOCALE_FILES.update({"cockpit-copy.js", "settings-copy.js", "mobile-copy.js", "coverage-copy.js", "recordings-copy.js"})
SHARED_FILES = {"/i18n.js": FRONTEND / "i18n.js", "/factory-copy.js": FRONTEND / "factory-copy.js",
                "/measurement-series.js": FRONTEND / "measurement-series.js",
                **{f"/locales/{name}": FRONTEND / "locales" / name for name in LOCALE_FILES}}
DATA_ENDPOINTS = {"/api/status", "/api/latest", "/api/device"}


def phone_url(bind, port):
    """Use the LAN interface chosen by the OS. UDP connect only selects a route."""
    if bind in ("", "0.0.0.0"):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as route:
                route.connect(("192.0.2.1", 9))
                bind = route.getsockname()[0]
        except OSError:
            try:
                addresses = socket.gethostbyname_ex(socket.gethostname())[2]
                bind = next(ip for ip in addresses if not ipaddress.ip_address(ip).is_loopback)
            except (OSError, StopIteration):
                return None
    if bind == "localhost" or ipaddress.ip_address(socket.gethostbyname(bind)).is_loopback:
        return None
    return f"http://{bind}:{port}/"


class MonitorHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, backend_port, **kwargs):
        self.backend_port = backend_port
        super().__init__(*args, directory=str(PHONE), **kwargs)

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
            config = {"backendPort": self.backend_port}
            return self.send_payload(json.dumps(config).encode(), "application/json; charset=utf-8")
        if path == "/ws/stream":
            return self.relay_stream()
        if path in SHARED_FILES:
            try:
                payload = SHARED_FILES[path].read_bytes()
            except OSError:
                return self.send_error(404, "Shared module not found")
            return self.send_payload(payload, "text/javascript; charset=utf-8")
        if path not in DATA_ENDPOINTS:
            return super().do_GET()

        connection = HTTPConnection("127.0.0.1", self.backend_port, timeout=2)
        try:
            connection.request("GET", path)
            reply = connection.getresponse()
            if reply.status != 200:
                return self.send_error(502, "Sensor backend did not return data")
            payload = reply.read()
        except (OSError, HTTPException):
            return self.send_error(502, "Sensor backend is unreachable")
        finally:
            connection.close()
        self.send_payload(payload, "application/json; charset=utf-8")

    def relay_stream(self):
        """Tunnel the WebSocket handshake and frames only to the PC's fixed stream."""
        key = self.headers.get("Sec-WebSocket-Key", "")
        try:
            valid_key = len(base64.b64decode(key, validate=True)) == 16
        except ValueError:
            valid_key = False
        if not (valid_key and self.headers.get("Upgrade", "").lower() == "websocket"
                and self.headers.get("Sec-WebSocket-Version") == "13"):
            return self.send_error(400, "WebSocket upgrade required")
        self.close_connection = True
        upgraded = False
        try:
            with socket.create_connection(("127.0.0.1", self.backend_port), timeout=3) as upstream:
                request = (f"GET /ws/stream HTTP/1.1\r\nHost: 127.0.0.1:{self.backend_port}\r\n"
                           "Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\n"
                           f"Sec-WebSocket-Key: {key}\r\n\r\n")
                upstream.sendall(request.encode("ascii"))
                # Unbuffered headers leave an immediately following first frame on the socket.
                with upstream.makefile("rb", buffering=0) as response:
                    if response.readline(256).split()[:2] != [b"HTTP/1.1", b"101"]:
                        return self.send_error(502, "Sensor stream unavailable")
                    accept = parse_headers(response).get("Sec-WebSocket-Accept")
                if not accept:
                    return self.send_error(502, "Sensor stream unavailable")
                self.protocol_version = "HTTP/1.1"
                self.send_response(101)
                self.send_header("Upgrade", "websocket")
                self.send_header("Connection", "Upgrade")
                self.send_header("Sec-WebSocket-Accept", accept)
                self.end_headers()
                upgraded = True
                peers = {upstream: self.connection, self.connection: upstream}
                self.connection.settimeout(5)
                while True:
                    for source in select.select(list(peers), [], [])[0]:
                        data = source.recv(65536)
                        if not data:
                            return
                        peers[source].sendall(data)
        except (OSError, HTTPException):
            if not upgraded:
                self.send_error(502, "Sensor stream unavailable")


def open_relay(bind, requested_port, backend_port):
    handler = partial(MonitorHandler, backend_port=backend_port)
    port = DEFAULT_PORT if requested_port is None else requested_port
    if port == backend_port:
        if requested_port is not None:
            raise ValueError("Handy- und Messserver benötigen unterschiedliche Ports.")
        port = 0
    try:
        return ThreadingHTTPServer((bind, port), handler)
    except OSError as exc:
        if requested_port is not None or exc.errno != errno.EADDRINUSE:
            raise
        return ThreadingHTTPServer((bind, 0), handler)


@contextmanager
def published_address(server, backend_port):
    url = phone_url(*server.server_address[:2])
    if not url:
        print("Handy-Ansicht: Keine WLAN-Adresse gefunden.", flush=True)
        yield
        return
    print(f"Handy im gleichen WLAN: {url}", flush=True)
    descriptor = FRONTEND / f"phone-access-{backend_port}.json"
    unique_id = uuid4().hex
    record = {"url": url, "pid": os.getpid(), "instance": unique_id}
    temp = descriptor.with_suffix(f".{unique_id}.tmp")
    try:
        temp.write_text(json.dumps(record), encoding="utf-8")
        temp.replace(descriptor)
    except OSError as exc:
        print(f"Handy-Adresse konnte nicht im Cockpit hinterlegt werden: {exc}", file=sys.stderr)
    try:
        yield
    finally:
        try:
            if json.loads(descriptor.read_text(encoding="utf-8")).get("instance") == unique_id:
                descriptor.unlink()
        except (OSError, ValueError):
            pass
        try:
            temp.unlink(missing_ok=True)
        except OSError:
            pass


def run_with_backend(arguments):
    """Let Uvicorn keep ownership of the main thread, signals and CLI options."""
    from click.exceptions import ClickException, Exit
    from uvicorn.main import main as uvicorn_cli

    try:
        with uvicorn_cli.make_context("uvicorn", arguments, auto_envvar_prefix="UVICORN") as context:
            options = context.params
            port = options["port"]
            if (options["host"] not in ("127.0.0.1", "localhost", "0.0.0.0") or not port or options["uds"]
                    or options["fd"] is not None or options["ssl_certfile"]):
                print("Handy-Freigabe benötigt einen lokalen HTTP-Messserver mit festem Port.", file=sys.stderr)
                return uvicorn_cli.invoke(context)
            # A second launch must not overwrite the active PC's published phone address.
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
                probe.settimeout(0.3)
                if probe.connect_ex(("127.0.0.1", port)) == 0:
                    print(f"Der Port {port} des Messservers ist bereits belegt.", file=sys.stderr)
                    raise SystemExit(1)
            print(f"Micro-Epsilon Live-Monitor: http://127.0.0.1:{port}/", flush=True)
            try:
                server = open_relay("0.0.0.0", None, port)
            except OSError as exc:
                print(f"Handy-Freigabe konnte nicht starten: {exc}", file=sys.stderr)
                return uvicorn_cli.invoke(context)
            with server, published_address(server, port):
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                try:
                    return uvicorn_cli.invoke(context)
                finally:
                    server.shutdown()
                    thread.join()
    except ClickException as exc:
        exc.show()
        raise SystemExit(exc.exit_code)
    except Exit as exc:
        raise SystemExit(exc.exit_code)


def main():
    if sys.argv[1:2] == ["--with-backend"]:
        return run_with_backend(sys.argv[2:])
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bind", default="0.0.0.0")
    parser.add_argument("--port", type=int, help="Handy-Port (Standard: 4174 oder ein freier Port)")
    parser.add_argument("--backend-port", default=8000, type=int)
    args = parser.parse_args()
    if any(port is not None and not 1 <= port <= 65535 for port in (args.port, args.backend_port)):
        parser.error("Port numbers must be between 1 and 65535.")
    try:
        with open_relay(args.bind, args.port, args.backend_port) as server, published_address(server, args.backend_port):
            print(f"Mobiler Messplatz auf Port {server.server_port}, Sensor-Backend auf 127.0.0.1:{args.backend_port}", flush=True)
            server.serve_forever()
    except KeyboardInterrupt:
        pass
    except (ValueError, OSError) as exc:
        parser.exit(1, f"Handy-Server konnte nicht starten: {exc}\n")


if __name__ == "__main__":
    def terminate(signum, _frame):
        # Also clean up the published address on service shutdown.
        raise SystemExit(128 + signum)

    signal.signal(signal.SIGTERM, terminate)
    try:
        main()
    except KeyboardInterrupt:
        pass
