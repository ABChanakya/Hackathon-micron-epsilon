import json, os, random, sys, tempfile, unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import anomaly  # noqa: E402

RATE = 1000          # samples/s
INFO = {"model": "TEST-10", "unit": "mm", "serial": "1"}


class Feeder:
    def __init__(self, agent):
        self.agent, self.t, self.rng = agent, 0.0, random.Random(7)

    def run(self, seconds, level=5.0, noise=0.002, invalid=False, dropped=0, intensity=None):
        for _ in range(int(seconds * RATE)):
            self.t += 1 / RATE
            v = None if invalid else level + self.rng.gauss(0, noise)
            self.agent.feed(self.t, v, {} if intensity is None else {"intensity_pct": intensity + self.rng.gauss(0, 0.3)}, dropped, 1.8e9)


class AnomalyAgentTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        cfg = {**anomaly.DEFAULTS, "error_file": os.path.join(self.dir, "errors.jsonl"), "warmup_s": 5.0,
               "cooldown_s": 0.0}
        self.agent = anomaly.AnomalyAgent(self.dir, cfg)
        self.agent.start(INFO, "sim")
        self.feed = Feeder(self.agent)

    def pending(self):
        return [e for e in self.agent.events if e["status"] == "pending"]

    def test_learns_then_stays_quiet_on_normal_signal(self):
        self.feed.run(5.5)
        self.assertTrue(self.agent._ready())
        self.feed.run(20)
        self.assertEqual(self.pending(), [])
        self.assertEqual(self.agent.frame()["state"], "watching")

    def test_noise_burst_is_flagged_and_fine_label_absorbs_it(self):
        self.feed.run(6)
        self.feed.run(2, noise=0.05)                 # 25x the normal noise
        ev = self.pending()
        self.assertEqual(len(ev), 1)
        self.assertIn(ev[0]["reason"], ("std", "p2p", "jitter"))
        self.agent.label(ev[0]["id"], "normal", "rough surface, fine")
        self.feed.run(1)
        self.feed.run(2, noise=0.05)                 # the same pattern again: a person said it is fine
        self.assertEqual(self.pending(), [])

    def test_not_fine_label_marks_later_similar_windows_as_known_anomaly(self):
        self.feed.run(6)
        self.feed.run(2, level=5.5)                  # level step of 0.5 mm
        ev = self.pending()[0]
        self.assertEqual(ev["reason"], "mean")
        self.agent.label(ev["id"], "anomaly", "part missing")
        self.feed.run(2)
        self.feed.run(2, level=5.5)
        known = [e for e in self.agent.events if e.get("known")]
        self.assertTrue(known)
        self.assertEqual(known[-1]["status"], "anomaly")
        self.assertEqual(known[-1]["label_note"], "part missing")

    def test_fine_confirms_the_whole_window_and_suggests_its_peaks(self):
        clock = {"t": 1.8e9}
        anomaly.time = type("T", (), {"time": staticmethod(lambda: clock["t"])})   # grace/cooldown follow the signal, not the wall clock
        try:
            f = self.feed
            f.run(6)
            for amp in (0.30, 0.35):                         # a typical dip, flagged the first time
                f.run(1.5, level=5.0 - amp); f.run(3)
            pend = self.pending()
            self.assertTrue(pend)
            self.agent.label(pend[-1]["id"], "normal", "typisch", 30)
            sug = self.agent.suggest(30)
            self.assertAlmostEqual(sug["hi"], 5.0, delta=0.02)          # the highest value of the stretch
            self.assertAlmostEqual(sug["lo"], 4.65, delta=0.02)         # the lowest: the deepest dip seen
            clock["t"] += 60                                  # the grace period is long over
            for amp in (0.32, 0.33, 0.31):                    # similar dips of other depths: no longer flagged
                f.run(1.5, level=5.0 - amp); f.run(3)
            self.assertEqual(self.pending(), [])
            f.run(1.5, level=3.0)                             # a dip far beyond what was confirmed is still flagged
            f.run(1)
            self.assertTrue(self.pending())
        finally:
            import time
            anomaly.time = time

    def test_an_unanswered_flag_expires_when_a_newer_one_comes(self):
        self.feed.run(6)
        self.feed.run(2, noise=0.05); self.feed.run(3)
        first = self.pending()[-1]["id"]
        self.feed.run(2, level=7.0); self.feed.run(3)
        status = {e["id"]: e["status"] for e in self.agent.events}
        self.assertEqual(status[first], "expired")
        self.assertEqual(len(self.pending()), 1)

    def test_taught_anomaly_is_recognised_even_when_not_unusual(self):
        # normal: two materials (levels 4 and 6, intensity 30-45); anomaly: a dark material at level 5, intensity 20
        rng = random.Random(1)
        win = lambda level, inten: {"mean": level + rng.gauss(0, 0.05), "std": 0.003, "p2p": 0.02, "slope": 0.005,
                                    "jitter": 0.0005, "err_frac": 0.0, "intensity": inten + rng.gauss(0, 1)}
        self.agent.learn_windows([win(4, 30) for _ in range(20)] + [win(6, 45) for _ in range(20)])
        self.agent.learn_windows([win(5, 20) for _ in range(20)], "anomaly", "black metal")
        self.assertIsNone(self.agent._classify(win(4, 31)))
        hit = self.agent._classify(win(5, 20))
        self.assertIsNotNone(hit)
        self.assertEqual(hit["note"], "black metal")
        self.assertEqual(self.agent._why(hit), "intensity")

    def test_error_codes_go_to_the_error_file_and_are_never_learned(self):
        self.feed.run(6)
        self.feed.run(2, invalid=True)
        self.feed.run(1)                              # signal back: the error event is closed and written
        self.assertTrue(all(b["err_frac"] < 0.5 for b in self.agent.baseline))
        with open(self.agent.error_path()) as fh:
            lines = [json.loads(x) for x in fh]
        self.assertEqual(len(lines), 1)
        self.assertEqual(lines[0]["reason"], "invalid_samples")
        self.assertEqual(lines[0]["sensor"], "TEST-10")
        self.assertEqual(self.pending(), [])
        with self.assertRaises(ValueError):
            self.agent.label(lines[0]["id"], "normal")

    def test_a_few_lost_samples_are_not_an_error_but_many_are(self):
        self.feed.run(6)
        self.feed.run(0.5, dropped=1)
        self.feed.run(1, dropped=1)
        self.assertFalse([e for e in self.agent.events if e["status"] == "error"])
        self.feed.run(0.5, dropped=5000)
        self.feed.run(1, dropped=5000)
        self.assertEqual([e["reason"] for e in self.agent.events if e["status"] == "error"], ["dropped_samples"])

    def test_hard_limit_is_an_error(self):
        self.agent.set_config({"hard_max": 5.2})
        self.feed.run(6)
        self.feed.run(1, level=5.4)
        self.feed.run(1)
        errs = [e for e in self.agent.events if e["status"] == "error"]
        self.assertEqual(errs[0]["reason"], "hard_limit")

    def test_model_survives_reconnect(self):
        self.feed.run(6)
        self.agent.stop()
        again = anomaly.AnomalyAgent(self.dir, self.agent.cfg)
        again.start(INFO, "sim")
        self.assertTrue(again._ready())
        self.assertEqual(again.frame()["state"], "watching")

    def _labeled_recording(self, level, intensity, n=40, label="normal"):
        rng = random.Random(int(level * 100))
        feats = [{"mean": level + rng.gauss(0, 0.01), "std": 0.002, "p2p": 0.0115, "slope": 0.0005, "jitter": 0.0029,
                  "err_frac": 0.0, "intensity": intensity + rng.gauss(0, 0.3)} for _ in range(n)]
        return feats, (level - 0.05, level + 0.05)

    def test_labeled_recordings_set_the_limits_and_the_matching_radius_from_the_data(self):
        for name, level, inten in (("white", 4.0, 27), ("paper", 5.5, 45), ("grey", 3.0, 44)):
            feats, rng_ = self._labeled_recording(level, inten)
            self.agent.learn_windows(feats, "normal", name, rng_)
        st = self.agent.status()
        self.assertEqual(st["labeled_windows"], 120)
        lo, hi = self.agent.train_range
        self.assertAlmostEqual(lo, 2.95 + self.agent.offset, places=3)      # the limits follow the training data ...
        self.assertAlmostEqual(hi, 5.55 + self.agent.offset, places=3)
        self.assertIsNotNone(st["auto_radius"], "... and so does the matching radius")
        self.assertGreaterEqual(st["auto_radius"], 2.0)
        self.agent.set_config({"label_match_radius": 7})
        self.assertEqual(self.agent.status()["match_radius"], 7.0, "a fixed value overrides the calibration")
        self.agent.set_config({"label_match_radius": None})
        self.assertEqual(self.agent.status()["match_radius"], st["auto_radius"])

    def test_data_that_matches_no_labeled_data_asks_a_person_and_the_answer_becomes_labeled_data(self):
        for name, level, inten in (("white", 5.0, 27), ("paper", 5.0, 29), ("grey", 5.0, 31)):
            feats, rng_ = self._labeled_recording(level, inten)
            self.agent.learn_windows(feats, "normal", name, rng_)
        self.agent.set_config({"sensitivity": 100})           # only the match against labeled data decides here
        f = self.feed
        f.run(2, level=5.0, intensity=27)                     # known: quiet
        self.assertEqual(self.pending(), [])
        f.run(3, level=5.0, intensity=8)                      # a surface unlike any labeled recording
        ev = self.pending()
        self.assertTrue(ev)
        self.assertEqual(ev[-1]["reason"], "no_match")
        self.assertIn(ev[-1]["nearest"]["note"], ("white", "paper", "grey"))
        self.agent.label(ev[-1]["id"], "normal", "dunkle Folie", 5)
        self.agent.cfg["cooldown_s"] = 0
        import time as _t
        self.agent.grace_until = 0
        f.run(1, level=5.0, intensity=27); f.run(3, level=5.0, intensity=8)   # the same surface again: now known
        self.assertEqual([e for e in self.pending() if e["reason"] == "no_match"], [])

    def test_shipped_seed_model_is_loaded_on_a_fresh_machine(self):
        seed = anomaly.AnomalyAgent(tempfile.mkdtemp(), {**anomaly.DEFAULTS})
        seed.start({"model": "ILD1900-10", "unit": "mm", "smr_mm": 20}, "serial-ild1900")
        self.assertTrue(seed._ready(), "trained on the real recordings, no warm-up needed")
        self.assertGreater(len(seed.anomaly_ex), 0, "black metal is taught as anomaly")
        self.assertEqual(seed.frame()["state"], "watching")

    def test_label_match_radius_validates_optional_boundaries(self):
        for value in (0.49, 500.1, float("nan"), float("inf")):
            with self.subTest(value=value), self.assertRaises(ValueError):
                anomaly.validate_config({"label_match_radius": value}, anomaly.DEFAULTS)
        for value in (0.5, 500, None, ""):
            with self.subTest(value=value):
                config = anomaly.validate_config({"label_match_radius": value}, anomaly.DEFAULTS)
                self.assertEqual(config["label_match_radius"], None if value in (None, "") else value)

    def test_config_validation(self):
        with self.assertRaises(ValueError):
            self.agent.set_config({"sensitivity": 0})
        with self.assertRaises(ValueError):
            self.agent.set_config({"nope": 1})
        with self.assertRaises(ValueError):
            self.agent.set_config({"error_file": "x.txt"})
        self.assertEqual(self.agent.set_config({"sensitivity": 8})["sensitivity"], 8.0)


if __name__ == "__main__":
    unittest.main()
