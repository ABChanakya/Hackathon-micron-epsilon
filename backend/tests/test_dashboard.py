"""In-process checks: no network listener or real sensor is opened."""
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app as backend
from hub import Hub


class DashboardTests(unittest.TestCase):
    def setUp(self):
        # Each test owns its isolated simulator hub, never a running server's sensor.
        self.hub = Hub()
        self.patch = patch.object(backend, "hub", self.hub)
        self.patch.start()
        self.client = TestClient(backend.app)
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.patch.stop()

    def test_monitor_and_assets_share_the_api_origin(self):
        page = self.client.get("/")
        self.assertEqual(page.status_code, 200)
        self.assertIn("Sensor Monitor", page.text)
        self.assertEqual(self.client.get("/app.js").status_code, 200)
        self.assertEqual(self.client.get("/style.css").status_code, 200)
        self.assertEqual(self.client.get("/pitch/").status_code, 200)
        self.assertEqual(self.client.get("/pitch/page.js").status_code, 200)
        self.assertEqual(self.client.get("/pitch/assets/ild1900.png").status_code, 200)
        self.assertEqual(self.client.get("/api/status").json()["status"], "disconnected")
        self.assertIsNone(self.client.get("/api/latest").json())

    def test_opening_monitor_or_diagnostics_does_not_select_a_source(self):
        self.client.get("/")
        diagnostics = self.client.get("/diagnostics/")
        self.assertEqual(diagnostics.status_code, 200)
        self.assertIn("Backend test page", diagnostics.text)
        status = self.client.get("/api/status").json()
        self.assertEqual(status["status"], "disconnected")
        self.assertIsNone(status["source"])

    def test_native_and_bridge_frames_identify_their_source(self):
        response = self.client.post("/api/connect", json={"sensor": "SIM"})
        self.assertEqual(response.status_code, 200)
        with self.client.websocket_connect("/ws/stream") as socket:
            frame = socket.receive_json()
        self.assertEqual(frame["source"], "sim")
        self.assertEqual(frame["info"]["model"], "SIM-ILD1420-50")
        self.assertEqual(frame["info"]["smr_mm"], 35)
        self.assertEqual(frame["info"]["range_mm"], 50)
        self.assertIn("dist_from_face_mm", frame)
        self.assertEqual(self.client.get("/api/latest").json()["source"], "sim")
        with self.client.websocket_connect("/ws/bridge") as socket:
            bridge = socket.receive_json()
        self.assertEqual(bridge["source"], "sim")
        self.assertEqual(bridge["sensor"], frame["info"]["model"])
        self.assertIsInstance(bridge["current_valid"], bool)
        self.assertEqual(bridge["range_start"], 35)
        self.assertEqual(bridge["range_end"], 85)


if __name__ == "__main__":
    unittest.main()
