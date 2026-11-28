"""Reset is exercised only against temporary models, never the workspace ML directory."""
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import anomaly


class ResetContractTest(unittest.TestCase):
    def test_reset_scope_preserves_history_error_log_and_other_models(self):
        for keep_labels in (True, False):
            with self.subTest(keep_labels=keep_labels), tempfile.TemporaryDirectory() as directory:
                error_path = Path(directory) / 'errors.jsonl'
                error_path.write_text('{"reason":"invalid_samples"}\n')
                config = {**anomaly.DEFAULTS, 'error_file': str(error_path)}
                agent = anomaly.AnomalyAgent(directory, config)
                agent.start({'model': 'OTHER', 'unit': 'mm', 'serial': '2'}, 'sim')
                agent.baseline.append({'mean': 20})
                agent._save()
                other_path = Path(agent.model_path())
                other_contents = other_path.read_bytes()
                agent.start({'model': 'TEST-10', 'unit': 'mm', 'serial': '1'}, 'sim')
                agent.baseline.append({'mean': 25})
                agent.normal_ex = [{'features': {'mean': 25}}]
                agent.anomaly_ex = [{'features': {'mean': 26}}]
                agent.events.extend([{'id': 'rated', 'status': 'normal'}, {'id': 'open', 'status': 'pending'}, {'id': 'error', 'status': 'error'}])
                agent.reset(keep_labels=keep_labels)
                self.assertEqual(len(agent.baseline), 0)
                self.assertEqual(len(agent.normal_ex), 1 if keep_labels else 0)
                self.assertEqual(len(agent.anomaly_ex), 1 if keep_labels else 0)
                self.assertEqual([event['id'] for event in agent.events], ['rated', 'error'])
                self.assertEqual(error_path.read_text(), '{"reason":"invalid_samples"}\n')
                self.assertEqual(other_path.read_bytes(), other_contents)
                saved = json.loads(Path(agent.model_path()).read_text())
                self.assertEqual(saved['baseline'], [])
                self.assertEqual(len(saved['normal']), 1 if keep_labels else 0)
                agent.stop()


if __name__ == '__main__':
    unittest.main()
