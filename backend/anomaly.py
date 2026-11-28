"""Anomaly agent: learns what a normal signal looks like and flags windows that do not.

The hub feeds every raw sample (not the 25 fps display frames). Samples are cut into short windows
(default 0.5 s). Each window becomes a feature vector:
    mean, std, p2p (peak-to-peak), slope (|trend| per s), jitter (std of sample-to-sample steps),
    err_frac (share of invalid samples), intensity (mean signal intensity %, optical sensors only).

Model: per sensor, a robust baseline (median and MAD of every feature over the learned normal windows).
The score of a window is the largest robust z-score (how many "normal spreads" a feature is away from
normal). Noise-type features only count upwards: a quieter signal is not an anomaly.
On top of the baseline sit the human labels (nearest neighbour in z-space):
    a window close to a confirmed "fine" example is not flagged,
    a window close to a confirmed "not fine" example is flagged as a known anomaly.

Every window ends in exactly one of three classes:
    normal   score below `sensitivity`. It feeds the baseline (warm-up, then `learn_online`).
    flagged  score at or above `sensitivity` for `consecutive` windows. Becomes a pending event that a person
             labels: "normal" moves it into the normal set, "anomaly" into the anomaly set.
    error    too many invalid (sensor error code) or lost samples (share >= `error_fraction`), a value beyond the hard limits,
             or a score at or above `reject_z`. Never learned, discarded, and written as one JSON line per
             event to `error_file` (for other tools to pick up).
Pure Python; it runs inside the hub's sensor thread.
"""
import json, math, os, threading, time
from collections import deque
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ML_DIR = os.path.join(BASE_DIR, "ml")
SEED_DIR = os.path.join(BASE_DIR, "ml_seed")     # committed, trained models; used when ml/ has none for a sensor yet

FEATURES = ("mean", "std", "p2p", "slope", "jitter", "err_frac", "intensity")
TWO_SIDED = {"mean", "intensity"}           # a shift either way is unusual; all others only count upwards
FLOOR_MULT = {"mean": 2.0, "std": 0.5, "p2p": 1.0, "slope": 2.0, "jitter": 0.5}
UNIT_FLOOR = {"mm": 0.005, "°C": 0.05}       # smallest spread that counts as "different" in the sensor unit
REL_FLOOR = 0.05                             # ...and at least 5 % of the normal value for noise-type features
BASELINE_MAX = 1200                          # normal windows kept (10 min at 0.5 s), oldest dropped first
EXAMPLES_MAX = 300                           # labelled examples kept per class
EVENTS_MAX = 200
LABELED_PER_RECORDING = 60                   # windows kept per labeled recording (evenly spread)
LABELED_MAX = 1500
MATCH_KEYS = ("mean", "intensity", "std", "p2p", "jitter")
MATCH_FLOOR = {"mean": 0.25, "intensity": 0.5, "std": 0.001, "p2p": 0.004, "jitter": 0.0005}   # smallest spread that counts
MIN_LABELED = 20                             # labeled windows needed before "no match" is used
RECENT_S = 900                               # seconds of window history kept, so "fine" can teach the last 10/30/60 s
OK_MARGIN = 0.10                             # a confirmed range is widened by 10 % of its width on each side
MATCH_REL = 0.25                             # labelled examples far from normal match with a tolerance of 25 % of their z per radius unit
ERROR_FLUSH_S = 5.0                          # a long error event is written in pieces of at most this length

DEFAULTS = {
    "enabled": True,
    "window_s": 0.5,          # window length in s
    "warmup_s": 10.0,         # s of normal signal learned after connecting before anything is flagged
    "sensitivity": 6.0,       # robust z-score from which a window is unusual
    "consecutive": 2,         # unusual windows in a row before a flag is raised
    "cooldown_s": 5.0,        # quiet time after a flag before the next one
    "reject_z": None,         # z-score from which a window is an error and discarded; None = off
    "error_fraction": 0.5,    # share of invalid samples in a window from which it is an error
    "hard_min": None,         # values below this are an error (as shown: mm from the sensor face, or °C); None = off
    "hard_max": None,         # values above this are an error; None = off
    "match_radius": 3.0,      # z-distance within which a window counts as "like" a labelled example
    "learn_online": True,     # keep adding normal windows to the baseline while watching
    "label_match": True,      # ask a person when a window matches none of the labeled data (recordings and answers)
    "label_match_radius": None,   # None = calibrated from the labeled data itself; or a fixed distance (within-recording spreads)
    "error_file": "ml/errors.jsonl",   # relative to backend/, or absolute; one JSON object per line
}
LIMITS = {"window_s": (0.1, 10.0), "warmup_s": (1.0, 600.0), "sensitivity": (1.5, 100.0), "consecutive": (1, 50),
          "cooldown_s": (0.0, 600.0), "error_fraction": (0.01, 1.0), "match_radius": (0.1, 50.0)}


def _median(xs):
    s = sorted(xs)
    n = len(s)
    return s[n // 2] if n % 2 else 0.5 * (s[n // 2 - 1] + s[n // 2])


def window_features(ts, vs, n_total, intensities=None):
    """Features of one window. ts/vs: times and values of the VALID samples; n_total includes invalid ones."""
    n = len(vs)
    f = {"err_frac": 1.0 - n / n_total if n_total else 1.0}
    if n:
        m = sum(vs) / n
        f["mean"] = m
        f["std"] = math.sqrt(sum((v - m) ** 2 for v in vs) / n)
        f["p2p"] = max(vs) - min(vs)
    if n >= 3:
        tm = sum(ts) / n
        den = sum((t - tm) ** 2 for t in ts)
        f["slope"] = abs(sum((t - tm) * (v - f["mean"]) for t, v in zip(ts, vs)) / den) if den > 0 else 0.0
        d = [b - a for a, b in zip(vs, vs[1:])]
        dm = sum(d) / len(d)
        f["jitter"] = math.sqrt(sum((x - dm) ** 2 for x in d) / len(d))
    if intensities:
        f["intensity"] = sum(intensities) / len(intensities)
    return f


def load_config(ml_dir=ML_DIR):
    cfg = dict(DEFAULTS)
    try:
        with open(os.path.join(ml_dir, "config.json")) as fh:
            cfg.update({k: v for k, v in json.load(fh).items() if k in DEFAULTS})
    except (OSError, ValueError):
        pass
    return cfg


def validate_config(body, current):
    """Merge a partial config into the current one, checking types and ranges. Raises ValueError."""
    cfg = dict(current)
    for k, v in body.items():
        if k not in DEFAULTS:
            raise ValueError(f"unknown setting: {k}")
        if k in ("enabled", "learn_online", "label_match"):
            cfg[k] = bool(v)
        elif k in ("hard_min", "hard_max", "reject_z", "label_match_radius"):
            cfg[k] = None if v in (None, "") else float(v)
            if k == "label_match_radius" and cfg[k] is not None and not 0.5 <= cfg[k] <= 500:
                raise ValueError("label_match_radius must be between 0.5 and 500 (or empty for automatic)")
        elif k == "error_file":
            v = str(v).strip()
            if not v.endswith(".jsonl"):
                raise ValueError("error_file must end in .jsonl")
            cfg[k] = v
        else:
            lo, hi = LIMITS[k]
            x = int(v) if k == "consecutive" else float(v)
            if not lo <= x <= hi:
                raise ValueError(f"{k} must be between {lo} and {hi}")
            cfg[k] = x
    if cfg["hard_min"] is not None and cfg["hard_max"] is not None and cfg["hard_min"] >= cfg["hard_max"]:
        raise ValueError("hard_min must be below hard_max")
    if cfg["reject_z"] is not None and cfg["reject_z"] <= cfg["sensitivity"]:
        raise ValueError("reject_z must be above sensitivity")
    return cfg


def _key(info):
    model = str((info or {}).get("model") or "unknown")
    if model.startswith("ILD1900"):         # recordings say "ILD1900", the live sensor "ILD1900-10": one model
        model = "ILD1900"
    unit = (info or {}).get("unit", "mm")
    return "".join(c if c.isalnum() or c in "-_" else "_" for c in f"{model}_{'C' if unit == '°C' else unit}")


class AnomalyAgent:
    def __init__(self, ml_dir=None, config=None):
        self.ml_dir = ml_dir = ml_dir or os.environ.get("SENSOR_ML_DIR") or ML_DIR   # env: keep tests out of backend/ml
        self.cfg = dict(config) if config is not None else load_config(ml_dir)
        self.lock = threading.Lock()          # the API thread reads status/events while the sensor thread feeds
        self.info, self.key, self.unit, self.source, self.offset = {}, None, "mm", None, 0.0
        self._clear_model()
        self.events = deque(maxlen=EVENTS_MAX)
        self.recent = deque()                 # {t, f, lo, hi}: the last RECENT_S seconds of non-error windows
        self.errors_written = 0
        self.last_error_line = None
        self._reset_stream()

    # ---- model state -------------------------------------------------------------------
    def _clear_model(self):
        self.baseline = deque(maxlen=BASELINE_MAX)
        self.normal_ex, self.anomaly_ex = [], []
        self.stats = None                     # {feature: (median, scale)}
        self.ok_ranges = {}                   # feature -> [lo, hi]: what people confirmed as fine (union over all answers)
        self.labeled = []                     # {f, cls, note}: windows of labeled recordings and of human answers
        self.within = {}                      # feature -> [spread inside one recording, ...] (scale for matching)
        self.train_range = None               # [lo, hi] of everything labeled normal (as shown: mm from the face, or °C)
        self.auto_radius = None               # match radius calibrated from the labeled data
        self.learned_windows = 0              # windows learned since the model was (re)started

    def _reset_stream(self):
        self.w_t0, self.w_ts, self.w_vs, self.w_int, self.w_n = None, [], [], [], 0
        self.w_drop0, self.w_hard = None, None
        self.streak, self.streak_feats = 0, []
        self.cool_until = 0.0
        self.grace_until = 0.0                # after "this is fine": the confirmed situation, not a new anomaly
        self.open_event = None                # flagged event still growing
        self.open_error = None                # error event still growing
        self.score, self.reason, self.cls = None, None, None
        self.warm_left = self.cfg["warmup_s"]

    def model_path(self):
        return os.path.join(self.ml_dir, f"model_{self.key}.json")

    def start(self, info, source):
        """A sensor (or replay) was connected: load the model learned for this sensor, if there is one."""
        with self.lock:
            self.info, self.source = dict(info or {}), source
            self.unit = self.info.get("unit", "mm")
            # values reach the agent as the sensor sends them (optoNCDT: from the start of the measuring range);
            # events and hard limits use what the monitor shows (mm from the sensor face, or °C)
            self.offset = float(self.info.get("smr_mm") or 0.0) if self.unit == "mm" else 0.0
            self.key = _key(self.info)
            self._clear_model()
            self._reset_stream()
            try:
                path = self.model_path()
                if not os.path.isfile(path):       # first run on this machine: start from the shipped, trained model
                    path = os.path.join(SEED_DIR, os.path.basename(path))
                with open(path) as fh:
                    m = json.load(fh)
                self.baseline.extend(m.get("baseline", []))
                self.normal_ex, self.anomaly_ex = m.get("normal", []), m.get("anomaly", [])
                self.ok_ranges = m.get("ok_ranges", {})
                self.labeled, self.within = m.get("labeled", []), m.get("within", {})
                self.train_range, self.auto_radius = m.get("train_range"), m.get("auto_radius")
                self.learned_windows = len(self.baseline)
                self._refit()
            except (OSError, ValueError):
                pass
            if self._ready():
                self.warm_left = 0.0

    def stop(self):
        with self.lock:
            self._close_error()
            self._save()
            self.key = None

    def reset(self, keep_labels=False):
        """Forget the baseline (learn again from the next seconds); optionally keep the human labels."""
        with self.lock:
            ex = (self.normal_ex, self.anomaly_ex, self.ok_ranges, self.labeled, self.within, self.train_range, self.auto_radius)
            self._clear_model()
            if keep_labels:
                (self.normal_ex, self.anomaly_ex, self.ok_ranges, self.labeled, self.within,
                 self.train_range, self.auto_radius) = ex
            self._reset_stream()
            self.events = deque((e for e in self.events if e["status"] != "pending"), maxlen=EVENTS_MAX)
            self._save()

    def _save(self):
        if not self.key:
            return
        os.makedirs(self.ml_dir, exist_ok=True)
        tmp = self.model_path() + ".tmp"
        with open(tmp, "w") as fh:
            json.dump({"key": self.key, "info": self.info, "saved": _now(), "features": FEATURES,
                       "baseline": list(self.baseline), "normal": self.normal_ex, "anomaly": self.anomaly_ex,
                       "ok_ranges": self.ok_ranges, "labeled": self.labeled, "within": self.within,
                       "train_range": self.train_range, "auto_radius": self.auto_radius}, fh)
        os.replace(tmp, self.model_path())

    def _ready(self):
        return self.stats is not None and len(self.baseline) >= max(3, int(self.cfg["warmup_s"] / self.cfg["window_s"]))

    def _refit(self):
        if len(self.baseline) < 3:
            self.stats = None
            return
        base = UNIT_FLOOR.get(self.unit, 0.001)
        stats = {}
        for k in FEATURES:
            xs = [b[k] for b in self.baseline if k in b]
            if len(xs) < 3:
                continue
            med = _median(xs)
            mad = _median([abs(x - med) for x in xs])
            if k == "err_frac":
                floor = 0.02
            elif k == "intensity":
                floor = 1.0
            else:
                floor = base * FLOOR_MULT[k] if k == "mean" else max(base * FLOOR_MULT[k], REL_FLOOR * abs(med))
            stats[k] = (med, max(1.4826 * mad, floor))
        self.stats = stats

    def _z(self, f):
        """Signed z-scores per feature against the baseline."""
        return {k: (f[k] - med) / sc for k, (med, sc) in self.stats.items() if k in f}

    def _score(self, z):
        best, why = 0.0, None
        for k, v in z.items():
            s = abs(v) if k in TWO_SIDED else v
            if s > best:
                best, why = s, k
        return best, why

    def _near(self, z, examples):
        """The closest labelled example that shows the same kind of deviation, or None.
        Only the features that are unusual in this window are compared (a window is "like" an example when it
        deviates in the same way). Per feature the distance is in z-units, relative for examples far from normal
        (a level 175 spreads away matches 175 +- 3*43.75, not +- 3); for noise-type features a window that is no
        worse than the example matches."""
        thr = self.cfg["sensitivity"]
        keys = [k for k, v in z.items() if (abs(v) if k in TWO_SIDED else v) >= thr]
        if not keys:
            return None
        best, hit = self.cfg["match_radius"], None
        for ex in examples:
            ez = self._z(ex["f"])
            if any(k not in ez for k in keys):
                continue
            d = 0.0
            for k in keys:
                if k not in TWO_SIDED and z[k] <= ez[k]:
                    continue
                d = max(d, abs(z[k] - ez[k]) / max(1.0, MATCH_REL * abs(ez[k])))
            if d <= best:
                best, hit = d, ex
        return hit

    # ---- labeled data: recordings and human answers --------------------------------------
    def _add_labeled(self, feats, cls, note, cap=LABELED_PER_RECORDING):
        """Keep an evenly spread sample of these windows as labeled data, and learn how much a feature varies inside one
        recording (that is the scale for "close to", much finer than the spread over all materials)."""
        if not feats:
            return
        step = max(1, len(feats) // cap)
        self.labeled = (self.labeled + [{"f": f, "cls": cls, "note": note} for f in feats[::step]])[-LABELED_MAX:]
        if len(feats) >= 8:
            for k in MATCH_KEYS:
                xs = [f[k] for f in feats if k in f]
                if len(xs) >= 8:
                    med = _median(xs)
                    self.within.setdefault(k, []).append(1.4826 * _median([abs(x - med) for x in xs]))
                    self.within[k] = self.within[k][-200:]
        self._calibrate()

    def _add_range(self, lo, hi):
        """Widen the range of everything labeled normal (this is what the evaluation limits are fitted to)."""
        if lo is None or hi is None:
            return
        r = self.train_range
        self.train_range = [round(min(lo, r[0]) if r else lo, 6), round(max(hi, r[1]) if r else hi, 6)]

    def _calibrate(self):
        """Match radius from the training data itself: how far is a window of one labeled recording from the nearest
        window of another? A new take of something known should land inside that (95th percentile, 25 % margin)."""
        notes = {e.get("note") for e in self.labeled}
        if len(self.labeled) < MIN_LABELED or len(notes) < 2:
            self.auto_radius = None
            return
        scales = {k: self._match_scale(k) for k in MATCH_KEYS}
        step = max(1, len(self.labeled) // 120)
        dists = []
        for ex in self.labeled[::step]:
            best = None
            for other in self.labeled:
                if other.get("note") == ex.get("note"):
                    continue
                ks = [k for k in MATCH_KEYS if k in ex["f"] and k in other["f"]]
                if ks:
                    d = math.sqrt(sum(((ex["f"][k] - other["f"][k]) / scales[k]) ** 2 for k in ks) / len(ks))
                    best = d if best is None else min(best, d)
            if best is not None:
                dists.append(best)
        if dists:
            dists.sort()
            self.auto_radius = round(max(2.0, 1.25 * dists[min(len(dists) - 1, int(0.95 * len(dists)))]), 2)

    def _radius(self):
        return self.cfg["label_match_radius"] if self.cfg["label_match_radius"] is not None else self.auto_radius

    def _match_scale(self, k):
        spreads = self.within.get(k)
        return max(_median(spreads) if spreads else 0.0, MATCH_FLOOR[k])

    def _match(self, f):
        """(distance, example) of the labeled window closest to `f`, or None. Distance: root mean square over the
        features, each in units of its typical spread inside one recording."""
        if len(self.labeled) < MIN_LABELED:
            return None
        scales = {k: self._match_scale(k) for k in MATCH_KEYS}
        best, hit = None, None
        for ex in self.labeled:
            g = ex["f"]
            ks = [k for k in MATCH_KEYS if k in f and k in g]
            if not ks:
                continue
            d = math.sqrt(sum(((f[k] - g[k]) / scales[k]) ** 2 for k in ks) / len(ks))
            if best is None or d < best:
                best, hit = d, ex
        return None if hit is None else (best, hit)

    def _nearest_info(self, f):
        m = self._match(f)
        return None if m is None else {"distance": round(m[0], 2), "note": m[1].get("note", ""), "cls": m[1]["cls"]}

    def _within_ok(self, f):
        """True when every feature that is unusual in this window lies inside the range people confirmed as fine."""
        if not self.ok_ranges or not self.stats:
            return False
        z = self._z(f)
        hot = [k for k, v in z.items() if (abs(v) if k in TWO_SIDED else v) >= self.cfg["sensitivity"]]
        if not hot:
            return False
        for k in hot:
            r = self.ok_ranges.get(k)
            if not r:
                return False
            margin = OK_MARGIN * (r[1] - r[0]) + 0.5 * self.stats[k][1]
            if not (r[0] - margin <= f[k] <= r[1] + margin):
                return False
        return True

    def _recent_since(self, seconds):
        if not self.recent:
            return []
        cutoff = self.recent[-1]["t"] - seconds
        return [w for w in self.recent if w["t"] >= cutoff]

    def suggest(self, seconds):
        """Highest and lowest value of the last `seconds` (as shown: mm from the sensor face, or °C) and how many
        windows that covers; None when there is nothing yet. This is what "fine" would confirm."""
        with self.lock:
            win = self._recent_since(float(seconds))
            if not win:
                return None
            return {"lo": round(min(w["lo"] for w in win), 6), "hi": round(max(w["hi"] for w in win), 6),
                    "seconds": round(len(win) * self.cfg["window_s"], 1), "windows": len(win), "unit": self.unit}

    def _learn_normal(self, windows, note="", event=None, reason="confirmed"):
        """Teach windows as normal: baseline, labelled examples, and the confirmed ranges per feature."""
        feats = [w["f"] if "f" in w and isinstance(w.get("f"), dict) else w for w in windows]
        if not feats:
            return 0
        ex = [{"f": f, "reason": reason, "note": note, "event": event, "at": _now()} for f in feats]
        self.normal_ex = (self.normal_ex + ex)[-EXAMPLES_MAX:]
        self.baseline.extend(feats)
        for k in FEATURES:
            xs = [f[k] for f in feats if k in f]
            if xs:
                r = self.ok_ranges.get(k)
                self.ok_ranges[k] = [min(xs + ([r[0]] if r else [])), max(xs + ([r[1]] if r else []))]
        self.learned_windows += len(feats)
        self._refit()
        return len(feats)

    def learn_recent(self, seconds, note=""):
        """Learn the last `seconds` as normal without an event (the person accepted a limit deviation)."""
        with self.lock:
            n = self._learn_normal(self._recent_since(float(seconds)), note, None, "recent")
            self.grace_until = time.time() + max(15.0, self.cfg["cooldown_s"])
            self._save()
            return {"learned_windows": n, "suggest": self._suggest_locked(seconds)}

    def _suggest_locked(self, seconds):
        win = self._recent_since(float(seconds))
        return None if not win else {"lo": round(min(w["lo"] for w in win), 6), "hi": round(max(w["hi"] for w in win), 6),
                                     "seconds": round(len(win) * self.cfg["window_s"], 1), "windows": len(win), "unit": self.unit}

    def _classify(self, f, k=5):
        """k nearest neighbours over all features (scaled by the normal spread) among the labelled anomaly examples
        and the normal windows (baseline + "fine" examples). Returns the closest anomaly example if most of the k
        neighbours are anomalies, else None. This is what lets a person teach an anomaly that is not unusual on its
        own, e.g. a material that looks like the others except for its signal intensity."""
        if not self.stats:
            return None
        sc = {key: s for key, (_, s) in self.stats.items()}

        def dist(g):
            common = [key for key in sc if key in f and key in g]
            return math.sqrt(sum(((f[key] - g[key]) / sc[key]) ** 2 for key in common) / len(common)) if common else 1e9

        cands = [(dist(ex["f"]), True, ex) for ex in self.anomaly_ex]
        cands += [(dist(g), False, None) for g in self.baseline]
        cands += [(dist(ex["f"]), False, None) for ex in self.normal_ex]
        near = sorted(cands, key=lambda c: c[0])[:k]
        votes = sum(1 for c in near if c[1])
        if votes * 2 <= len(near):
            return None
        best = min((c for c in near if c[1]), key=lambda c: c[0])[2]
        return best

    def _why(self, best):
        """The feature that tells a taught anomaly apart from normal (e.g. intensity for a dark material): median over
        all examples taught together with `best`, so one odd window does not decide it."""
        group = [self._z(ex["f"]) for ex in self.anomaly_ex
                 if ex.get("note") == best.get("note") and ex.get("event") == best.get("event")] or [self._z(best["f"])]
        sep = {key: abs(_median([g[key] for g in group if key in g])) for key in group[0]}
        return max(sep, key=sep.get) if sep else best.get("reason")

    # ---- feeding -----------------------------------------------------------------------
    def feed(self, t, value, sample, dropped_total, hub_wall_off):
        """One raw sample. value None = invalid (sensor error code). Called by the hub thread only."""
        if not self.cfg["enabled"] or not self.key:
            return
        if self.w_t0 is None:
            self.w_t0, self.w_drop0 = t, dropped_total
        if t - self.w_t0 >= self.cfg["window_s"]:
            with self.lock:
                self._close_window(t, dropped_total, hub_wall_off)
            self.w_t0, self.w_ts, self.w_vs, self.w_int, self.w_n = t, [], [], [], 0
            self.w_drop0, self.w_hard = dropped_total, None
        self.w_n += 1
        if value is not None:
            self.w_ts.append(t); self.w_vs.append(value)
            lo, hi = self.cfg["hard_min"], self.cfg["hard_max"]
            shown = value + self.offset
            if self.w_hard is None and ((lo is not None and shown < lo) or (hi is not None and shown > hi)):
                self.w_hard = shown
            it = sample.get("intensity_pct")
            if it is not None:
                self.w_int.append(it)

    def _close_window(self, t_end, dropped_total, wall_off):
        f = window_features(self.w_ts, self.w_vs, self.w_n, self.w_int)
        t0 = self.w_t0
        dropped = dropped_total - (self.w_drop0 or 0)
        z = self._z(f) if self.stats else {}
        score, why = self._score(z) if z else (None, None)
        self.score = score
        err = None
        invalid = self.w_n - len(self.w_vs)
        if (invalid + dropped) / max(1, self.w_n + dropped) >= self.cfg["error_fraction"]:
            err = "dropped_samples" if dropped > invalid else "invalid_samples"
        elif self.w_hard is not None:
            err = "hard_limit"
        elif score is not None and self._ready() and self.cfg["reject_z"] is not None and score >= self.cfg["reject_z"] and not self._near(z, self.normal_ex):
            err = "extreme_score"
        if err:
            self.cls, self.reason = "error", err
            self.streak, self.streak_feats = 0, []
            self._error(err, f, z, score, wall_off + t0, wall_off + t_end, dropped)
            return
        self._close_error()
        if self.w_vs:
            self.recent.append({"t": wall_off + t_end, "f": f, "lo": min(self.w_vs) + self.offset,
                                "hi": max(self.w_vs) + self.offset})
            while self.recent and self.recent[0]["t"] < self.recent[-1]["t"] - RECENT_S:
                self.recent.popleft()

        if not self._ready():                 # warm-up: everything that is not an error is learned as normal
            self.cls, self.reason = "learning", None
            self.baseline.append(f); self.learned_windows += 1
            self.warm_left = max(0.0, self.warm_left - self.cfg["window_s"])
            if self.learned_windows % 4 == 0 or self.warm_left == 0:
                self._refit()
            return

        known = self._near(z, self.anomaly_ex)
        if known is None and self.anomaly_ex:
            known = self._classify(f)          # learned from labels: looks like a known anomaly, even if not unusual
        unusual = known is not None or score >= self.cfg["sensitivity"]
        unmatched = None
        if known is None and not unusual and self.cfg["label_match"]:
            m = self._match(f)
            radius = self._radius()
            if m is not None and radius is not None and m[0] > radius:
                unmatched, unusual, why = m, True, "no_match"          # like none of the labeled data: ask a person
        if unusual and self._near(z, self.normal_ex) and known is None:
            unusual = False                    # a person said windows like this are fine
        if unusual and known is None and self._within_ok(f):
            unusual = False                    # every unusual feature lies inside a range a person confirmed as fine
        if unusual and known is None and time.time() < self.grace_until:
            # Right after a "fine" answer the situation a person just confirmed goes on: learn it, do not ask again.
            self.normal_ex = (self.normal_ex + [{"f": f, "reason": why, "note": "", "event": None, "at": _now()}])[-EXAMPLES_MAX:]
            unusual = False
        if not unusual:
            self.cls, self.reason = "normal", None
            self.streak, self.streak_feats = 0, []
            if self.open_event:
                self.open_event = None
            if self.cfg["learn_online"]:
                self.baseline.append(f); self.learned_windows += 1
                if self.learned_windows % 8 == 0:
                    self._refit()
            return

        self.cls, self.reason = ("known_anomaly" if known else "flagged"), (self._why(known) if known else why)
        self.streak += 1
        self.streak_feats.append(f)
        ev = self.open_event
        if ev is not None:                     # the same anomaly continues: grow the event
            ev["t_end"] = _iso(wall_off + t_end); ev["windows"] += 1; ev["_t1"] = wall_off + t_end
            if score > ev["score"]:
                ev.update(score=round(score, 2), z=_round(z), features=_round(f), value=self._shown(f))
                if not ev["known"]:            # a known anomaly keeps the reason it was taught with
                    ev["reason"] = self.reason
            if len(ev["_f"]) < 20:
                ev["_f"].append(f)
            return
        if self.streak < self.cfg["consecutive"] or time.time() < self.cool_until:
            return
        ev = {"id": f"ml-{int(time.time() * 1000)}", "status": "anomaly" if known else "pending",
              "known": bool(known), "label_note": known.get("note", "") if known else "",
              "t_start": _iso(wall_off + t_end - self.streak * self.cfg["window_s"]), "t_end": _iso(wall_off + t_end),
              "windows": self.streak, "score": round(score, 2), "reason": self.reason, "z": _round(z),
              "features": _round(f), "value": self._shown(f), "unit": self.unit, "sensor": self.info.get("model"),
              "serial": self.info.get("serial"), "source": self.source, "replay_of": self.info.get("replay_of"),
              "nearest": self._nearest_info(f),
              "_f": list(self.streak_feats), "_t1": wall_off + t_end}
        for old in self.events:                # an unanswered older flag is stale now: never ask about it again
            if old["status"] == "pending":
                old["status"] = "expired"
        self.events.append(ev)
        self.open_event = ev
        self.cool_until = time.time() + self.cfg["cooldown_s"]

    def _shown(self, f):
        return None if f.get("mean") is None else round(f["mean"] + self.offset, 6)

    def _error(self, reason, f, z, score, w0, w1, dropped):
        e = self.open_error
        if e and e["reason"] == reason and w1 - e["_w0"] <= ERROR_FLUSH_S:
            e["t_end"] = _iso(w1); e["windows"] += 1; e["dropped"] += dropped
            e["worst_value"] = _worst(e["worst_value"], self.w_hard if self.w_hard is not None else self._shown(f), self.cfg)
            return
        self._close_error()
        self.open_error = {"type": "error", "reason": reason, "t_start": _iso(w0), "t_end": _iso(w1), "windows": 1,
                           "dropped": dropped, "score": None if score is None else round(score, 2),
                           "features": _round(f), "z": _round(z), "unit": self.unit,
                           "worst_value": self.w_hard if self.w_hard is not None else self._shown(f),
                           "sensor": self.info.get("model"), "serial": self.info.get("serial"),
                           "source": self.source, "replay_of": self.info.get("replay_of"), "_w0": w0}

    def _close_error(self):
        e, self.open_error = self.open_error, None
        if not e:
            return
        e.pop("_w0", None)
        e["id"] = f"err-{int(time.time() * 1000)}-{self.errors_written}"
        e["status"] = "error"
        self.events.append(dict(e))
        path = self.error_path()
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "a") as fh:
                fh.write(json.dumps(e, ensure_ascii=False) + "\n")
            self.errors_written += 1
            self.last_error_line = e
        except OSError:
            pass

    def error_path(self):
        p = self.cfg["error_file"]
        return p if os.path.isabs(p) else os.path.join(BASE_DIR, p)

    # ---- human labels ------------------------------------------------------------------
    def label(self, event_id, label, note="", learn_s=None):
        if label not in ("normal", "anomaly"):
            raise ValueError("label must be 'normal' or 'anomaly'")
        with self.lock:
            ev = next((e for e in self.events if e["id"] == event_id), None)
            if ev is None:
                raise KeyError(f"no such event: {event_id}")
            if ev["status"] == "error":
                raise ValueError("errors are discarded and cannot be labelled")
            feats = ev.get("_f") or [ev["features"]]
            ex = [{"f": f, "reason": ev["reason"], "note": note, "event": event_id, "at": _now()} for f in feats]
            if label == "normal":
                self.grace_until = time.time() + max(15.0, self.cfg["cooldown_s"])
                self.anomaly_ex = [a for a in self.anomaly_ex if a.get("event") != event_id]
                # "fine" confirms the whole recent stretch (the last 10/30/60 s the person saw), not just the flagged windows
                recent = self._recent_since(float(learn_s)) if learn_s else []
                self._learn_normal([{"f": f} for f in feats] + recent, note, event_id, ev["reason"])
                self._add_labeled(feats + [w["f"] for w in recent], "normal", note or "Antwort: in Ordnung")
                ex = [e for e in self.normal_ex if e.get("event") == event_id] or ex
                if learn_s:
                    ev["suggest"] = self._suggest_locked(learn_s)
                    if ev["suggest"]:
                        self._add_range(ev["suggest"]["lo"], ev["suggest"]["hi"])
            else:
                self.anomaly_ex = (self.anomaly_ex + ex)[-EXAMPLES_MAX:]
                self.normal_ex = [a for a in self.normal_ex if a.get("event") != event_id]
                self._add_labeled(feats, "anomaly", note or "Antwort: nicht in Ordnung")
            ev.update(status=label, label_note=note, labelled_at=_now())
            cutoff = self.recent[-1]["t"] - float(learn_s) if (learn_s and self.recent) else None
            for other in self.events:          # open events inside the confirmed stretch, or like it, get the same answer
                if label == "normal" and other is not ev and other["status"] == "pending" and self.stats:
                    oz = self._z(other["features"])
                    inside = cutoff is not None and other.get("_t1", 0) >= cutoff
                    if inside or self._near(oz, ex) or self._score(oz)[0] < self.cfg["sensitivity"]:
                        other.update(status="normal", label_note=note, labelled_at=_now(), auto=True)
            if self.open_event is ev:
                self.open_event = None
            self._save()
            self._log_label(ev)
            return _public(ev)

    def _log_label(self, ev):
        try:
            os.makedirs(self.ml_dir, exist_ok=True)
            with open(os.path.join(self.ml_dir, "labels.jsonl"), "a") as fh:
                fh.write(json.dumps(_public(ev), ensure_ascii=False) + "\n")
        except OSError:
            pass

    def learn_windows(self, feats, label="normal", note="", value_range=None):
        """Learn the windows of a recording: as normal (baseline) or as anomaly examples. `value_range` is the lowest and
        highest value of the recording (raw sensor units); for a normal recording the evaluation limits follow it."""
        with self.lock:
            self._add_labeled(feats, "anomaly" if label == "anomaly" else "normal", note)
            if label != "anomaly" and value_range:
                self._add_range(value_range[0] + self.offset, value_range[1] + self.offset)
            if label == "anomaly":
                ex = [{"f": f, "reason": "recording", "note": note, "event": None, "at": _now()} for f in feats]
                self.anomaly_ex = (self.anomaly_ex + ex)[-EXAMPLES_MAX:]
                self._save()
                return len(feats)
            self.baseline.extend(feats)
            self.learned_windows += len(feats)
            self._refit()
            if self._ready():
                self.warm_left = 0.0
            self._save()
            return len(feats)

    def set_config(self, body):
        with self.lock:
            new = validate_config(body, self.cfg)
            os.makedirs(self.ml_dir, exist_ok=True)
            with open(os.path.join(self.ml_dir, "config.json"), "w") as fh:
                json.dump(new, fh, indent=2)
            relearn = new["window_s"] != self.cfg["window_s"]
            self.cfg = new
            if relearn:                        # features depend on the window length: learn again
                self._clear_model(); self._reset_stream()
            return dict(self.cfg)

    # ---- read side ---------------------------------------------------------------------
    def frame(self):
        """Small summary for every /ws/stream frame."""
        if not self.cfg["enabled"] or not self.key:
            return {"enabled": self.cfg["enabled"], "state": "idle" if self.cfg["enabled"] else "off",
                    "pending": None, "pending_count": 0, "errors_written": self.errors_written}
        pending = [e for e in self.events if e["status"] == "pending"]
        state = "learning" if not self._ready() else {"error": "error", "flagged": "alert",
                                                       "known_anomaly": "alert"}.get(self.cls, "watching")
        need = self.cfg["warmup_s"]
        return {"enabled": True, "state": state, "reason": self.reason,
                "score": None if self.score is None else round(self.score, 2), "sensitivity": self.cfg["sensitivity"],
                "progress": 1.0 if self._ready() else round(min(1.0, (need - self.warm_left) / need), 2),
                "pending": _public(pending[-1]) if pending else None, "pending_count": len(pending),
                "known": _public(self.open_event) if self.cls == "known_anomaly" and self.open_event else None,
                "train_range": self.train_range,
                "errors_written": self.errors_written}

    def status(self):
        with self.lock:
            return {**self.frame(), "config": dict(self.cfg), "model": self.key, "sensor": self.info.get("model"), "baseline_windows": len(self.baseline),
                    "normal_examples": len(self.normal_ex), "anomaly_examples": len(self.anomaly_ex),
                    "labeled_windows": len(self.labeled), "match_radius": self._radius(), "auto_radius": self.auto_radius, "labeled_sources": sorted({e["note"] for e in self.labeled if e.get("note")})[:40],
                    "baseline": {k: {"median": _r(m), "spread": _r(s)} for k, (m, s) in (self.stats or {}).items()},
                    "error_file": self.error_path(), "last_error": self.last_error_line}

    def list_events(self, status=None, limit=50):
        with self.lock:
            evs = [_public(e) for e in self.events if status is None or e["status"] == status]
        return evs[-limit:][::-1]


def features_from_csv(path, window_s, value_col=None):
    """Windows of a recording CSV (backend/recordings) in the same features as the live stream.
    Windows that would be errors live (too many invalid or lost samples) are skipped."""
    import csv
    out, ts, vs, its, n, t0, last_c, lost = [], [], [], [], 0, None, None, 0
    with open(path, newline="") as fh:
        r = csv.DictReader(fh)
        col = value_col or ("temp_c" if "temp_c" in (r.fieldnames or []) else "dist_mm")
        for row in r:
            t = float(row["t_s"])
            if t0 is None:
                t0 = t
            if t - t0 >= window_s:
                f = window_features(ts, vs, n, its)
                if (n - len(vs) + lost) / max(1, n + lost) < DEFAULTS["error_fraction"]:
                    out.append(f)
                ts, vs, its, n, t0, lost = [], [], [], 0, t, 0
            n += 1
            c = row.get("counter")
            if c:
                c = int(c)
                if last_c is not None and 0 < c - last_c - 1 < 1000:
                    lost += c - last_c - 1
                last_c = c
            v = row.get(col)
            if v not in (None, "") and not row.get("error_code"):
                ts.append(t); vs.append(float(v))
                it = row.get("intensity_pct")
                if it:
                    its.append(float(it))
    return out


def csv_range(path):
    """(lowest, highest) valid value of a recording CSV in the sensor's own units, or None."""
    import csv
    lo = hi = None
    with open(path, newline="") as fh:
        r = csv.DictReader(fh)
        col = "temp_c" if "temp_c" in (r.fieldnames or []) else "dist_mm"
        for row in r:
            v = row.get(col)
            if v not in (None, "") and not row.get("error_code"):
                x = float(v)
                lo = x if lo is None else min(lo, x)
                hi = x if hi is None else max(hi, x)
    return None if lo is None else (lo, hi)


def _worst(a, b, cfg):
    if a is None or b is None:
        return a if b is None else b
    lo, hi = cfg["hard_min"], cfg["hard_max"]
    if hi is not None and max(a, b) > hi:
        return max(a, b)
    if lo is not None and min(a, b) < lo:
        return min(a, b)
    return a


def _public(e):
    return {k: v for k, v in e.items() if not k.startswith("_")}


def _r(x, nd=6):
    return None if x is None else round(x, nd)


def _round(d):
    return {k: _r(v) for k, v in d.items()}


def _iso(wall):
    return datetime.fromtimestamp(wall).isoformat(timespec="milliseconds")


def _now():
    return datetime.now().isoformat(timespec="seconds")
