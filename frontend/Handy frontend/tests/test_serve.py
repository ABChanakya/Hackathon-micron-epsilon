import base64
import hashlib
import importlib.util
import json
import socket
import tempfile
import threading
import unittest
from functools import partial
from http.client import HTTPConnection
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

PHONE = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("phone_server", PHONE / "serve.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PhoneServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        class QuietHandler(module.MonitorHandler):
            def log_message(self, *args):
                pass
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, backend_port=8765))
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def request(self, path, method="GET"):
        connection = HTTPConnection("127.0.0.1", self.server.server_port, timeout=2)
        connection.request(method, path)
        response = connection.getresponse()
        result = response.status, response.getheader("Content-Type"), response.read()
        connection.close()
        return result

    def test_config_reports_the_actual_backend_port(self):
        status, _, payload = self.request("/monitor-config.json")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(payload), {"backendPort": 8765})

    def test_shared_language_aliases_ignore_cache_query_and_serve_exact_files(self):
        for path in ["/i18n.js", "/factory-copy.js", "/measurement-series.js", "/locales/en.js", "/locales/mobile-copy.js", "/locales/coverage-copy.js", "/locales/recordings-copy.js"]:
            status, kind, payload = self.request(path + "?v=ui-review-1")
            self.assertEqual(status, 200, path)
            self.assertIn("javascript", kind)
            self.assertEqual(payload, module.SHARED_FILES[path].read_bytes())

    def test_unlisted_alias_and_mutating_api_methods_remain_unavailable(self):
        self.assertEqual(self.request("/locales/not-a-language.js")[0], 404)
        self.assertEqual(self.request("/api/ml/reset", "POST")[0], 501)

    def test_websocket_forwards_first_sensor_frame_without_requesting_other_paths(self):
        value = b'{"dist_from_face_mm":24.731,"current_valid":true}'
        frame = bytes([0x81, len(value)]) + value
        paths = []

        class Fixture(BaseHTTPRequestHandler):
            def do_GET(self):
                paths.append(self.path)
                key = self.headers["Sec-WebSocket-Key"].encode("ascii")
                accept = base64.b64encode(hashlib.sha1(key + b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest())
                # Send the first frame immediately after the headers, in the same write.
                self.wfile.write(b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n"
                                 b"Connection: Upgrade\r\nSec-WebSocket-Accept: " + accept + b"\r\n\r\n" + frame)

        with ThreadingHTTPServer(("127.0.0.1", 0), Fixture) as backend:
            relay = module.open_relay("127.0.0.1", 0, backend.server_port)
            with relay:
                servers = [backend, relay]
                for server in servers:
                    threading.Thread(target=server.serve_forever, daemon=True).start()
                try:
                    with socket.create_connection(relay.server_address, timeout=2) as client:
                        client.sendall(b"GET /ws/stream HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\n"
                                       b"Connection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n"
                                       b"Sec-WebSocket-Version: 13\r\n\r\n")
                        with client.makefile("rb") as reply:
                            self.assertIn(b" 101 ", reply.readline())
                            while reply.readline() not in (b"\r\n", b""):
                                pass
                            self.assertEqual(reply.read(len(frame)), frame)
                    self.assertEqual(paths, ["/ws/stream"])
                finally:
                    for server in servers:
                        server.shutdown()

    def test_automatic_phone_port_skips_occupied_port_but_explicit_port_is_respected(self):
        occupied = self.server.server_port
        with patch.object(module, "DEFAULT_PORT", occupied):
            with module.open_relay("127.0.0.1", None, 8765) as server:
                self.assertNotEqual(server.server_port, occupied)
            with self.assertRaises(OSError):
                module.open_relay("127.0.0.1", occupied, 8765)

    def test_address_is_scoped_to_backend_port_and_does_not_remove_a_newer_relay(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(module, "FRONTEND", Path(folder)), \
                patch.object(module, "phone_url", return_value="http://192.0.2.10:4174/"):
            path = Path(folder) / "phone-access-8765.json"
            with module.published_address(self.server, 8765):
                self.assertEqual(json.loads(path.read_text())["url"], "http://192.0.2.10:4174/")
            self.assertFalse(path.exists())
            with module.published_address(self.server, 8765):
                path.write_text(json.dumps({"instance": "newer"}))
            self.assertEqual(json.loads(path.read_text())["instance"], "newer")



if __name__ == "__main__":
    unittest.main()
