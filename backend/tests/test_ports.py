"""Which serial ports the sensor scan offers on each operating system."""
import os
import sys
import types
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import sources  # noqa: E402
from serial.tools import list_ports  # noqa: E402  (imported before sys.platform is patched)


class SerialPortsTest(unittest.TestCase):
    def test_windows_lists_com_ports_in_natural_order(self):
        found = [types.SimpleNamespace(device=name) for name in ("COM10", "COM3", "COM4")]
        with mock.patch.object(sys, "platform", "win32"), mock.patch.object(list_ports, "comports", return_value=found):
            self.assertEqual(sources.serial_ports(), ["COM3", "COM4", "COM10"])

    def test_macos_and_linux_use_usb_serial_device_names(self):
        names = {"/dev/cu.usbserial*": ["/dev/cu.usbserial-010720"], "/dev/ttyUSB*": ["/dev/ttyUSB0"]}
        with mock.patch.object(sys, "platform", "darwin"), mock.patch("glob.glob", side_effect=lambda p: names.get(p, [])):
            self.assertEqual(sources.serial_ports(), ["/dev/cu.usbserial-010720", "/dev/ttyUSB0"])


if __name__ == "__main__":
    unittest.main()
