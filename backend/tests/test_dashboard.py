"""In-process checks: no network listener or real sensor is opened."""
import sys
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app as backend
from hub import Hub


class ThermalFixture:
    """Deterministic temperature source; never opens a serial device."""
    kind = "thermo-uc"
    rate_hz = 50.0
    info = {"model": "UC-SF22-S3", "unit": "°C", "quantity": "temperature", "range_min": -50, "range_max": 900}

    def open(self, cfg):
        pass

    def close(self):
        pass

    def read(self):
        time.sleep(0.02)
        return [{"dist": 25.25, "head_c": 26.5, "electronics_c": 27.75}]


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
        self.assertIn("Sensor Cockpit", page.text)
        self.assertEqual(self.client.get("/app.js").status_code, 200)
        self.assertEqual(self.client.get("/style.css").status_code, 200)
        for asset in ["assistant.js", "assistant-ui.js", "assistant-i18n.js", "assistant.css",
                      "i18n.js", "assets/micro-epsilon-logo.svg"]:
            self.assertEqual(self.client.get("/" + asset).status_code, 200, asset)
        for language in ["en", "fr", "es", "it", "cs", "zh", "ja", "ko", "pirate"]:
            self.assertEqual(self.client.get(f"/locales/{language}.js").status_code, 200, language)
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
        # the simulator imitates the ILD1900-10 the monitor is built for
        self.assertEqual(frame["info"]["model"], "SIM-ILD1900-10")
        self.assertEqual(frame["info"]["smr_mm"], 20)
        self.assertEqual(frame["info"]["range_mm"], 10)
        self.assertIn("dist_from_face_mm", frame)
        self.assertEqual(self.client.get("/api/latest").json()["source"], "sim")
        with self.client.websocket_connect("/ws/bridge") as socket:
            bridge = socket.receive_json()
        self.assertEqual(bridge["source"], "sim")
        self.assertEqual(bridge["sensor"], frame["info"]["model"])
        self.assertEqual(bridge["info"], frame["info"])
        self.assertIsInstance(bridge["current_valid"], bool)
        self.assertEqual(bridge["range_start"], 20)
        self.assertEqual(bridge["range_end"], 30)

    def test_thermal_frames_preserve_temperature_metadata_and_ignore_display_tare_in_bridge(self):
        with patch.object(backend.hubmod, "ThermoSource", ThermalFixture):
            response = self.client.post("/api/connect", json={"sensor": "thermo", "port": "fixture-only"})
            self.assertEqual(response.status_code, 200)
            with self.client.websocket_connect("/ws/stream") as socket:
                frame = socket.receive_json()
            self.assertEqual(frame["source"], "thermo-uc")
            self.assertEqual(frame["info"]["model"], "UC-SF22-S3")
            self.assertEqual(frame["unit"], "°C")
            self.assertEqual(frame["raw_value"], 25.25)
            self.assertEqual(frame["head_c"], 26.5)
            self.assertEqual(frame["electronics_c"], 27.75)
            self.assertIsNone(frame["dist_from_face_mm"])
            self.assertIsNone(frame["state_flags"])
            self.assertEqual(self.client.post("/api/tare", json={"on": True}).status_code, 200)
            with self.client.websocket_connect("/ws/stream") as socket:
                zeroed = socket.receive_json()
            self.assertEqual(zeroed["value"], 0)
            self.assertEqual(zeroed["raw_value"], 25.25)
            with self.client.websocket_connect("/ws/bridge") as socket:
                bridge = socket.receive_json()
            self.assertEqual(bridge["source"], "thermo-uc")
            self.assertEqual(bridge["unit"], "°C")
            self.assertEqual(bridge["info"]["unit"], "°C")
            self.assertEqual(bridge["info"]["model"], "UC-SF22-S3")
            self.assertEqual(bridge["info"]["range_min"], -50)
            self.assertEqual(bridge["info"]["range_max"], 900)
            self.assertEqual(bridge["value"], 25.25)
            self.assertTrue(bridge["current_valid"])
            self.assertEqual(bridge["state"], "unknown")
            self.assertEqual(bridge["output"], "green")
            invalid = self.hub.bridge_message({**frame, "current_valid": False})
            self.assertFalse(invalid["current_valid"])
            self.assertIsNone(invalid["value"])


if __name__ == "__main__":
    unittest.main()
