"""Curated facts stay local, scoped and attributable; no PDF/network/model I/O."""
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlsplit
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from assistant_sensor_knowledge import SENSOR_FACTS, SENSOR_SOURCES, facts_for, sources_for


class AssistantSensorKnowledgeTest(unittest.TestCase):
    def test_known_sensor_ids_select_only_their_own_manual_and_facts(self):
        for sensor_id, source_id, own, other in [
            ("ild1900", "manual:optoncdt1900", "Optical triangulation", "emissivity"),
            ("thermo_uc", "manual:thermometer-uc", "infrared radiation", "CMOS"),
        ]:
            for sensor in [sensor_id, {"id": sensor_id}, SimpleNamespace(id=sensor_id)]:
                with self.subTest(sensor=sensor):
                    facts = facts_for(sensor)
                    self.assertIn(own, facts)
                    self.assertNotIn(other, facts)
                    self.assertEqual([source["id"] for source in sources_for(sensor)], [source_id])
                    self.assertIn(facts, SENSOR_FACTS)

    def test_unknown_or_missing_sensor_never_gets_guessed_hardware_knowledge(self):
        for sensor in [None, "unknown", {}, {"id": "opto1420", "model": "ILD1900-10"},
                       {"model": "thermoMETER UC-SF22-S3"}, SimpleNamespace(id="other")]:
            with self.subTest(sensor=sensor):
                self.assertEqual(facts_for(sensor), "")
                self.assertEqual(sources_for(sensor), [])

    def test_reviewed_sources_have_official_urls_model_scope_pages_and_date(self):
        self.assertEqual(len(SENSOR_SOURCES), 2)
        self.assertEqual(len({source["id"] for source in SENSOR_SOURCES}), 2)
        for source in SENSOR_SOURCES:
            url = urlsplit(source["url"])
            self.assertEqual(url.scheme, "https")
            self.assertIn(url.hostname, {"www.micro-epsilon.de", "www.micro-epsilon.com"})
            self.assertTrue(url.path.endswith(".pdf"))
            self.assertTrue(source["title"])
            self.assertTrue(source["models"])
            self.assertIn("§", source["reference"])
            self.assertIn("p.", source["reference"])
            self.assertEqual(source["retrievedAt"], "2026-11-28")

    def test_excerpts_are_short_and_distinguish_app_status_from_device_codes(self):
        for sensor_id in ["ild1900", "thermo_uc"]:
            facts = facts_for(sensor_id)
            self.assertLess(len(facts.split()), 150)
            self.assertIn("INVALID_SIGNAL", facts)
            self.assertIn("App guard:", facts)
            self.assertIn("Do not", facts)

    def test_response_source_copies_cannot_modify_trusted_metadata(self):
        expected = sources_for("ild1900")
        altered = sources_for("ild1900")
        altered[0]["url"] = "https://example.invalid"
        altered[0]["models"].append("unverified")
        self.assertEqual(sources_for("ild1900"), expected)


if __name__ == "__main__":
    unittest.main()
