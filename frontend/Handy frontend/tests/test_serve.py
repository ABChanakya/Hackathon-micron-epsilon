import importlib.util
import json
import threading
import unittest
from functools import partial
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path

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
        for path in ["/i18n.js", "/factory-copy.js", "/locales/en.js", "/locales/mobile-copy.js", "/locales/coverage-copy.js", "/locales/recordings-copy.js"]:
            status, kind, payload = self.request(path + "?v=ui-review-1")
            self.assertEqual(status, 200, path)
            self.assertIn("javascript", kind)
            self.assertEqual(payload, module.SHARED_FILES[path].read_bytes())

    def test_unlisted_alias_and_mutating_api_methods_remain_unavailable(self):
        self.assertEqual(self.request("/locales/not-a-language.js")[0], 404)
        self.assertEqual(self.request("/api/ml/reset", "POST")[0], 501)


if __name__ == "__main__":
    unittest.main()
