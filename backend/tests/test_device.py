import os, sys, unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from device import identify  # noqa: E402

ILD1900 = {"model": "ILD1900-10", "unit": "mm", "range_mm": 10.0, "smr_mm": 20, "serial": "1"}
ILD1420 = {"model": "ILD1420-50", "unit": "mm", "range_mm": 50.0, "smr_mm": 35}
THERMO = {"model": "UC-SF22-S3", "unit": "°C", "range_min": -50, "range_max": 900}


class DeviceCheckTest(unittest.TestCase):
    def test_known_devices_are_verified_with_their_layout(self):
        d = identify("serial-ild1900", ILD1900)
        self.assertEqual((d["family"], d["measures"], d["origin"], d["live"], d["verified"]),
                         ("ild1900", "distance", "hardware", True, True))
        self.assertTrue(d["ui"]["sensor_3d"])
        d = identify("thermo-uc", THERMO)
        self.assertEqual((d["family"], d["measures"], d["live"]), ("thermo_uc", "temperature", True))
        self.assertFalse(d["ui"]["sensor_3d"])
        self.assertEqual(identify("serial-ild1420", ILD1420)["family"], "ild1420")

    def test_simulator_and_replay_are_verified_but_not_live(self):
        sim = identify("sim", {**ILD1900, "model": "SIM-ILD1900-10"})
        self.assertEqual((sim["family"], sim["origin"], sim["verified"], sim["live"]), ("ild1900", "simulator", True, False))
        rep = identify("replay", {"model": "ILD1900", "unit": "mm", "range_mm": 10.0, "smr_mm": 20})
        self.assertEqual((rep["origin"], rep["verified"], rep["live"]), ("replay", True, False))

    def test_unknown_or_inconsistent_devices_are_rejected(self):
        self.assertFalse(identify("serial-ild1900", {"model": "Foo", "unit": "mm"})["verified"])
        self.assertIsNone(identify("serial-ild1900", {"model": "Foo", "unit": "mm"})["ui"])
        self.assertFalse(identify("replay", {"model": "recording", "unit": "mm"})["verified"])
        wrong_unit = identify("serial-ild1900", {**ILD1900, "unit": "°C"})
        self.assertFalse(wrong_unit["verified"])
        self.assertIn("unit", wrong_unit["problems"][0])
        self.assertFalse(identify("thermo-uc", {**THERMO, "range_max": 500})["verified"])
        self.assertFalse(identify("serial-ild1900", {**ILD1900, "smr_mm": 35})["verified"])
        self.assertFalse(identify("thermo-uc", ILD1900)["verified"])     # an ILD behind the thermometer driver
        self.assertFalse(identify("serial-ild1420", ILD1900)["verified"])


if __name__ == "__main__":
    unittest.main()
