"""The classifier: regularised LDA, implemented in numpy, stored as JSON.

Why not scikit-learn and a pickle
---------------------------------
The project's storage rule is CSV and JSON only, with pickle allowed
for a fitted model but always shadowed by a JSON metrics file. Linear
discriminant analysis is a matrix of weights and a vector of biases —
there is nothing in it that needs pickling. Writing the maths out in
numpy means the model IS the JSON: readable, diffable, portable, and
still loadable in ten years by anyone with a numpy install. No pickle,
no version-locked dependency, no binary blob in a medical record.

It also keeps the deployed decision boundary honest. `analysis.py`
already previews separability with a regularised Fisher discriminant;
this trains the same family of model, so a d' of 3.2 in the report
means the same thing the classifier will experience.

What it classifies
------------------
Three kinds of class, and the distinction matters:

  * **rest** — the arm doing nothing.
  * **movement** — ordinary everyday arm motion, from distractor probes.
    A detector that has never seen this fires on scratching.
  * **one class per promoted probe** — the actual intended signals.

`rest` and `movement` are both *reject* classes. Anything landing in
them produces no output. That is the whole false-positive defence.

Honest evaluation
-----------------
Accuracy on training data is meaningless — with 15 features and a few
hundred windows, a linear model can separate almost anything. So
evaluation is **grouped cross-validation**: whole repetitions are held
out together, never individual windows. Windows from the same
repetition are highly correlated, and splitting them across train and
test inflates accuracy dramatically. Reported numbers use held-out
repetitions only.
"""

from __future__ import annotations

import datetime as dt
import json
import math
import os
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np

import features as feat
from analysis import FEATURE_NAMES

MODEL_SCHEMA = "armband/model/2"

REJECT_CLASSES = ("rest", "movement")
SHRINKAGE = 0.15          # covariance regularisation; small data, 15 dims


def _now() -> str:
    return dt.datetime.now().strftime("%Y-%m-%dT%H:%M:%S")


class LinearModel:
    """Multi-class LDA: score = W x + b, highest score wins.

    Held as plain arrays so the whole thing serialises to JSON. Also
    carries the feature standardisation, because a model without the
    scaler that produced it is not a model.
    """

    def __init__(self, classes: List[str], weights: np.ndarray, bias: np.ndarray,
                 mean: np.ndarray, scale: np.ndarray,
                 metadata: Optional[Dict[str, Any]] = None,
                 feature_version: str = feat.DEFAULT_VERSION) -> None:
        self.feature_version = feature_version
        self.classes = list(classes)
        self.weights = np.asarray(weights, dtype=float)   # (n_classes, n_features)
        self.bias = np.asarray(bias, dtype=float)         # (n_classes,)
        self.mean = np.asarray(mean, dtype=float)         # (n_features,)
        self.scale = np.asarray(scale, dtype=float)       # (n_features,)
        self.metadata = metadata or {}

    # ---------------------------------------------------------- inference

    def _standardise(self, x: np.ndarray) -> np.ndarray:
        return (x - self.mean) / np.where(self.scale > 0, self.scale, 1.0)

    def scores(self, x: np.ndarray) -> np.ndarray:
        """Discriminant score per class for one feature vector."""
        return self.weights @ self._standardise(np.asarray(x, dtype=float)) + self.bias

    def probabilities(self, x: np.ndarray) -> np.ndarray:
        """Softmax over the discriminant scores.

        Calibrated enough to threshold on, not a true posterior — LDA
        scores are log-likelihoods only under assumptions this data does
        not satisfy. Treated as a confidence, and named as such.
        """
        s = self.scores(x)
        s = s - s.max()
        e = np.exp(s)
        total = e.sum()
        return e / total if total > 0 else np.full_like(e, 1.0 / len(e))

    def predict(self, x: np.ndarray) -> Tuple[str, float]:
        p = self.probabilities(x)
        i = int(np.argmax(p))
        return self.classes[i], float(p[i])

    def is_reject(self, label: str) -> bool:
        return label in REJECT_CLASSES

    # -------------------------------------------------------- persistence

    def to_dict(self) -> Dict[str, Any]:
        return {
            "schema":        MODEL_SCHEMA,
            "generated":     _now(),
            "classes":       self.classes,
            "feature_version": self.feature_version,
            "feature_names": list(feat.names(self.feature_version)),
            "reject_classes": list(REJECT_CLASSES),
            "standardiser":  {"mean": self.mean.tolist(),
                              "scale": self.scale.tolist()},
            "weights":       self.weights.tolist(),
            "bias":          self.bias.tolist(),
            "metadata":      self.metadata,
            # Counted from the file itself, never hardcoded. This note is
            # the instruction a stranger reads to re-implement scoring in
            # another language years from now, so a stale number in it is
            # worse than no note: it would send them building a 15-input
            # classifier for a 36-input model. (It said 15 from v1 until
            # 2026-08-10, long after the feature set grew.)
            "note": f"score = weights @ ((x - mean) / scale) + bias; "
                    f"highest score wins. x is the "
                    f"{len(feat.names(self.feature_version))}-element "
                    f"feature vector "
                    f"named in feature_names (feature set "
                    f"'{self.feature_version}'), computed over a 0.25s "
                    f"window.",
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "LinearModel":
        std = data.get("standardiser", {})
        return cls(
            classes=data["classes"],
            weights=np.asarray(data["weights"], dtype=float),
            bias=np.asarray(data["bias"], dtype=float),
            mean=np.asarray(std.get("mean", np.zeros(len(FEATURE_NAMES))), dtype=float),
            scale=np.asarray(std.get("scale", np.ones(len(FEATURE_NAMES))), dtype=float),
            metadata=data.get("metadata", {}),
            feature_version=data.get("feature_version", "v1"),
        )

    def save(self, path: str) -> str:
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self.to_dict(), f, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
        return path

    @classmethod
    def load(cls, path: str) -> Optional["LinearModel"]:
        if not os.path.exists(path):
            return None
        try:
            with open(path, "r", encoding="utf-8") as f:
                return cls.from_dict(json.load(f))
        except Exception:
            return None


# ================================================================ training


def fit(X: np.ndarray, y: Sequence[str], shrinkage: float = SHRINKAGE,
        balanced: bool = True,
        feature_version: str = feat.DEFAULT_VERSION,
        sample_weight: Optional[np.ndarray] = None) -> Optional[LinearModel]:
    """Regularised LDA. Returns None if the data cannot support a model.

    `balanced` sets uniform class priors instead of priors proportional
    to how much data each class has. That matters here: a 30-second rest
    recording contributes several times more windows than a handful of
    2-second attempts, and frequency-weighted priors bias every decision
    toward "rest" simply because resting is what an arm does most of the
    time. We are not trying to guess what the arm is most likely doing —
    we are trying to catch a deliberate signal when it happens.

    `sample_weight` (per window, same length as y) is honoured in the
    per-class means and the pooled covariance. Callers can weight
    windows by (1 - censorship_fraction) so heavily censored windows
    contribute less to the fit than clean ones. Uniform if None.
    """
    labels = sorted(set(y))
    if len(labels) < 2 or X.shape[0] < len(labels) * 2:
        return None

    y_arr = np.asarray(y)
    w = (np.ones(len(y_arr)) if sample_weight is None
         else np.asarray(sample_weight, dtype=float))
    if w.shape != (len(y_arr),):
        w = np.ones(len(y_arr))
    # Weighted global mean and scale so heavily censored windows
    # don't warp normalisation.
    total_w = float(w.sum()) or 1.0
    mean = (X * w[:, None]).sum(axis=0) / total_w
    var = (((X - mean) ** 2) * w[:, None]).sum(axis=0) / total_w
    scale = np.sqrt(np.maximum(var, 0))
    scale = np.where(scale > 0, scale, 1.0)
    Z = (X - mean) / scale

    n_features = Z.shape[1]
    pooled = np.zeros((n_features, n_features))
    means: List[np.ndarray] = []
    priors: List[float] = []
    for label in labels:
        m_lab = (y_arr == label)
        group = Z[m_lab]
        wg = w[m_lab]
        wg_sum = float(wg.sum()) or 1.0
        mu = (group * wg[:, None]).sum(axis=0) / wg_sum
        means.append(mu)
        priors.append(1.0 / len(labels) if balanced else wg_sum / total_w)
        centred = group - mu
        pooled += (centred * wg[:, None]).T @ centred
    pooled /= max(total_w - len(labels), 1.0)

    # Shrink toward a scaled identity — with 15 dimensions and often only
    # a few hundred windows, the raw covariance is near-singular and its
    # inverse amplifies noise into confident nonsense.
    lam = shrinkage * float(np.trace(pooled)) / n_features
    reg = (1 - shrinkage) * pooled + lam * np.eye(n_features)
    try:
        inv = np.linalg.inv(reg)
    except np.linalg.LinAlgError:
        inv = np.linalg.pinv(reg)

    weights = np.vstack([inv @ mu for mu in means])
    bias = np.array([
        -0.5 * mu @ inv @ mu + math.log(max(prior, 1e-9))
        for mu, prior in zip(means, priors)
    ])
    return LinearModel(labels, weights, bias, mean, scale,
                       feature_version=feature_version)


def cross_validate(X: np.ndarray, y: Sequence[str], groups: Sequence[Any],
                   shrinkage: float = SHRINKAGE) -> Dict[str, Any]:
    """Leave-one-repetition-out. Whole reps held out, never single windows.

    Splitting correlated windows from the same repetition across train
    and test is the classic way to report 99% accuracy on a model that
    does not work. Grouping by repetition is what makes these numbers
    mean something.
    """
    y_arr = np.asarray(y)
    g_arr = np.asarray(groups)
    labels = sorted(set(y))
    unique_groups = sorted(set(groups), key=str)
    if len(unique_groups) < 3:
        return {"available": False,
                "note": f"only {len(unique_groups)} repetitions — need at "
                        f"least 3 to cross-validate honestly"}

    index = {label: i for i, label in enumerate(labels)}
    confusion = np.zeros((len(labels), len(labels)), dtype=int)
    confidences: List[float] = []

    for held in unique_groups:
        test_mask = g_arr == held
        train_mask = ~test_mask
        if len(set(y_arr[train_mask])) < 2:
            continue
        fold = fit(X[train_mask], y_arr[train_mask], shrinkage)
        if fold is None:
            continue
        for xi, yi in zip(X[test_mask], y_arr[test_mask]):
            pred, conf = fold.predict(xi)
            confusion[index[yi], index[pred]] += 1
            confidences.append(conf)

    total = int(confusion.sum())
    if total == 0:
        return {"available": False, "note": "cross-validation produced no folds"}

    correct = int(np.trace(confusion))
    per_class = {}
    for label in labels:
        i = index[label]
        support = int(confusion[i].sum())
        recall = float(confusion[i, i] / support) if support else 0.0
        predicted = int(confusion[:, i].sum())
        precision = float(confusion[i, i] / predicted) if predicted else 0.0
        per_class[label] = {
            "recall": round(recall, 4),
            "precision": round(precision, 4),
            "support": support,
        }

    # The number that actually matters for a mouse button: how often does
    # a reject class get classified as a real signal?
    false_fires = 0
    reject_total = 0
    for label in labels:
        if label not in REJECT_CLASSES:
            continue
        i = index[label]
        reject_total += int(confusion[i].sum())
        for other in labels:
            if other not in REJECT_CLASSES:
                false_fires += int(confusion[i, index[other]])

    # The operationally meaningful view: reject vs signal. Confusing
    # "rest" with "everyday movement" costs nothing — both produce no
    # output. Confusing either with a real signal fires the mouse.
    signal_labels = [l for l in labels if l not in REJECT_CLASSES]
    binary = {"signal_recall": None, "false_fire_rate": None}
    signal_total = sum(int(confusion[index[l]].sum()) for l in signal_labels)
    if signal_total:
        caught = sum(int(confusion[index[l], index[o]])
                     for l in signal_labels for o in signal_labels)
        binary["signal_recall"] = round(caught / signal_total, 4)

    return {
        "available":      True,
        "method":         "leave-one-repetition-out (grouped)",
        "folds":          len(unique_groups),
        "accuracy":       round(correct / total, 4),
        "signal_recall":  binary["signal_recall"],
        "signal_recall_note": "share of real attempts detected as SOME signal "
                              "class — telling two signals apart is a separate "
                              "question from noticing one happened",
        "n_windows":      total,
        "labels":         labels,
        "confusion":      confusion.tolist(),
        "per_class":      per_class,
        "mean_confidence": round(float(np.mean(confidences)), 4) if confidences else 0.0,
        "false_fire_rate": round(false_fires / reject_total, 5) if reject_total else None,
        "false_fire_note": "share of rest/everyday-movement windows classified "
                           "as a real signal — the false-positive rate before "
                           "any hold time is applied",
    }


def choose_operating_point(X: np.ndarray, y: Sequence[str], groups: Sequence[Any],
                           target_false_fire: float = 0.01,
                           shrinkage: float = SHRINKAGE) -> Dict[str, Any]:
    """Pick the confidence threshold that meets a false-fire budget.

    Tuning class priors to trade recall against false fires is the wrong
    lever — it moves every boundary at once and is hard to reason about.
    The honest way is to fix the boundary, then require a minimum
    confidence before acting, and choose that minimum from held-out
    data to hit a stated budget.

    This is a one-sided decision on purpose. A missed click is a small
    annoyance he can simply repeat; a click that fires while he is
    scratching his arm is the failure that makes the whole system
    untrustworthy. So the threshold is chosen by the false-fire budget,
    and whatever recall remains is what we report.
    """
    y_arr = np.asarray(y)
    g_arr = np.asarray(groups)
    unique_groups = sorted(set(groups), key=str)
    if len(unique_groups) < 3:
        return {"available": False, "note": "not enough repetitions"}

    # Held-out confidence for the top SIGNAL class on every window.
    reject_conf: List[float] = []
    signal_conf: List[float] = []
    for held in unique_groups:
        test = g_arr == held
        train = ~test
        if len(set(y_arr[train])) < 2:
            continue
        fold = fit(X[train], y_arr[train], shrinkage)
        if fold is None:
            continue
        signal_idx = [i for i, c in enumerate(fold.classes)
                      if c not in REJECT_CLASSES]
        if not signal_idx:
            continue
        for xi, yi in zip(X[test], y_arr[test]):
            probabilities = fold.probabilities(xi)
            best_signal = float(max(probabilities[i] for i in signal_idx))
            (reject_conf if yi in REJECT_CLASSES else signal_conf).append(best_signal)

    if not reject_conf or not signal_conf:
        return {"available": False, "note": "no held-out windows to tune on"}

    reject = np.asarray(reject_conf)
    signal = np.asarray(signal_conf)
    # Lowest threshold whose false-fire rate meets the budget.
    chosen, achieved = 0.99, float((reject >= 0.99).mean())
    for threshold in np.arange(0.30, 0.999, 0.01):
        rate = float((reject >= threshold).mean())
        if rate <= target_false_fire:
            chosen, achieved = float(threshold), rate
            break

    recall = float((signal >= chosen).mean())
    return {
        "available":        True,
        "confidence_threshold": round(chosen, 3),
        "target_false_fire": target_false_fire,
        "false_fire_rate":  round(achieved, 5),
        "signal_recall":    round(recall, 4),
        "n_reject_windows": int(reject.size),
        "n_signal_windows": int(signal.size),
        "note": "per-window rates, before any hold time. Requiring N "
                "consecutive windows above the threshold multiplies the "
                "false-fire rate down roughly geometrically.",
    }


def hold_for_target(per_window_false_fire: float, target: float = 1e-4,
                    window_s: float = 0.25, max_windows: int = 12
                    ) -> Dict[str, Any]:
    """How many consecutive windows are needed to meet a false-fire target."""
    rate = max(float(per_window_false_fire), 1e-9)
    holds = 1
    while holds < max_windows and rate ** holds > target:
        holds += 1
    return {
        "hold_windows": holds,
        "hold_time_s": round(holds * window_s, 2),
        "projected_false_fire": rate ** holds,
        "note": "assumes consecutive windows are independent, which "
                "overstates the benefit slightly — real windows overlap "
                "and correlate, so treat this as a floor, not a promise",
    }


# ========================================================= dataset building


def _is_audit_compromised(path: str) -> bool:
    """True if the probe's CSV header has an `audit_status: compromised`
    line (written by armband/audit_clipping.py)."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                if line.startswith("# audit_status:"):
                    return "compromised" in line.lower()
                if not line.startswith("#"):
                    return False
    except Exception:
        pass
    return False


def build_dataset(session, promoted: Optional[Sequence[str]] = None,
                  extra_sessions: Optional[Sequence[Any]] = None,
                  feature_version: str = feat.DEFAULT_VERSION
                  ) -> Tuple[np.ndarray, List[str], List[str], Dict[str, Any]]:
    """Feature windows + labels + repetition groups, from recorded probes.

    `promoted` limits which movement probes become classes. Everything
    named there becomes a class; rest and distractor recordings always
    become the reject classes.
    """
    from probe_store import load_probe

    X: List[np.ndarray] = []
    y: List[str] = []
    groups: List[str] = []
    sources: Dict[str, int] = {}

    sessions = [session] + list(extra_sessions or [])
    skipped_compromised = 0
    skipped_discarded = 0
    for sess in sessions:
        if sess is None:
            continue
        for entry in sess.active_probes():
            path = sess.probe_path(entry.get("file", ""))
            if not os.path.exists(path):
                continue
            # Skip probes the auditor flagged as compromised (heavy
            # clipping or single-channel contact fault) — training on
            # those samples poisons the model with railed noise. The
            # raw file stays on disk; we just don't train on it.
            if _is_audit_compromised(path):
                skipped_compromised += 1
                continue
            # Skip probes the operator explicitly discarded via the
            # post-recording notes dialog.
            notes = (entry.get("operator_notes") or {})
            if notes.get("discard"):
                skipped_discarded += 1
                continue
            try:
                samples, meta = load_probe(path)
            except Exception:
                continue
            if samples.shape[1] == 0:
                continue
            fs = meta.sample_rate_hz or 1000
            kind = meta.kind or entry.get("kind", "probe")

            if kind in ("rest", "baseline"):
                label = "rest"
                windows, times = feat.windows(samples, fs, version=feature_version)
                # Chunk rest into pseudo-repetitions so grouped CV has
                # something to hold out.
                spans = [(i, f"{sess.stamp}:{entry['file']}:{i // 8}")
                         for i in range(len(windows))]
            elif kind == "distractor":
                label = "movement"
                windows, times = feat.windows(samples, fs, version=feature_version)
                spans = [(i, f"{sess.stamp}:{entry['file']}:{i // 8}")
                         for i in range(len(windows))]
            else:
                name = (meta.probe or entry.get("probe", "")).strip()
                if promoted is not None and name not in promoted:
                    continue
                label = name
                windows, times = feat.windows(samples, fs, version=feature_version)
                cues = entry.get("cues") or []
                if cues:
                    spans = []
                    for i, t in enumerate(times):
                        for r, (a, b) in enumerate(cues):
                            if a - 0.25 <= t <= b:
                                spans.append((i, f"{sess.stamp}:{entry['file']}:rep{r}"))
                                break
                else:
                    spans = [(i, f"{sess.stamp}:{entry['file']}:{i // 8}")
                             for i in range(len(windows))]

            for i, group in spans:
                if i < len(windows):
                    X.append(windows[i])
                    y.append(label)
                    groups.append(group)
            sources[label] = sources.get(label, 0) + len(spans)

    if not X:
        return np.zeros((0, feat.size(feature_version))), [], [], {"classes": {}}

    X_arr, y_arr, g_arr = np.vstack(X), np.asarray(y), np.asarray(groups)

    # Cap the reject classes. A 30-second rest recording yields ~240
    # windows; five 2-second attempts yield ~40. Left alone, rest is 70%+
    # of the dataset and dominates the pooled covariance — the boundary
    # ends up describing what resting looks like rather than where the
    # signal is. Capping at a multiple of the largest signal class keeps
    # plenty of negative evidence without letting it swamp everything.
    signal_counts = [int((y_arr == label).sum())
                     for label in set(y_arr) if label not in REJECT_CLASSES]
    if signal_counts:
        cap = max(max(signal_counts) * 3, 60)
        keep = np.ones(len(y_arr), dtype=bool)
        rng = np.random.default_rng(0)      # deterministic: same data, same model
        for label in REJECT_CLASSES:
            idx = np.flatnonzero(y_arr == label)
            if len(idx) > cap:
                drop = rng.choice(idx, size=len(idx) - cap, replace=False)
                keep[drop] = False
                sources[f"{label} (capped from {len(idx)})"] = cap
                sources.pop(label, None)
        X_arr, y_arr, g_arr = X_arr[keep], y_arr[keep], g_arr[keep]

    return (X_arr, [str(v) for v in y_arr], [str(v) for v in g_arr],
            {"classes": sources, "n_sessions": len(sessions),
             "skipped_compromised": skipped_compromised,
             "skipped_discarded": skipped_discarded})


def train(session, promoted: Optional[Sequence[str]] = None,
          extra_sessions: Optional[Sequence[Any]] = None,
          feature_version: str = feat.DEFAULT_VERSION,
          shrinkage: float = SHRINKAGE) -> Dict[str, Any]:
    """Build a dataset, fit, cross-validate, and report — all in one call."""
    X, y, groups, info = build_dataset(session, promoted, extra_sessions,
                                       feature_version)
    classes = sorted(set(y))
    real = [c for c in classes if c not in REJECT_CLASSES]

    if len(classes) < 2:
        return {"ok": False,
                "reason": "need at least two classes — record a movement and "
                          "an everyday-movement sample"}
    if not real:
        return {"ok": False,
                "reason": "no movement probes to learn; only rest and "
                          "everyday movement were found"}

    model = fit(X, y, shrinkage=shrinkage,
                feature_version=feature_version)
    if model is None:
        return {"ok": False, "reason": "not enough data to fit a model"}

    evaluation = cross_validate(X, y, groups, shrinkage)
    operating = choose_operating_point(X, y, groups,
                                       shrinkage=shrinkage)
    if operating.get("available"):
        operating.update(hold_for_target(operating["false_fire_rate"]))
    model.metadata = {
        "operating_point": operating,
        "trained":       _now(),
        "session":       getattr(session, "stamp", ""),
        "profile":       getattr(session, "profile", ""),
        "arm":           getattr(session, "arm", ""),
        "classes":       classes,
        "signal_classes": real,
        "n_windows":     int(X.shape[0]),
        "window_counts": info.get("classes", {}),
        "evaluation":    evaluation,
        "shrinkage":     shrinkage,
        "feature_version": feature_version,
    }
    return {"ok": True, "model": model, "evaluation": evaluation,
            "operating_point": operating, "classes": classes,
            "signal_classes": real, "n_windows": int(X.shape[0])}


# --------------------------------------------------------------- self-test

if __name__ == "__main__":
    import sys

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from profiles import ProfileStore

    store = ProfileStore()
    for name in (sys.argv[1:] or store.list_profiles()):
        try:
            profile = store.load(name)
        except Exception as exc:
            print(f"{name}: {exc}")
            continue
        for arm in ("left", "right"):
            sessions = [s for s in profile.sessions(arm) if s.active_probes()]
            if not sessions:
                continue
            latest = sessions[-1]
            result = train(latest, extra_sessions=sessions[:-1])
            print(f"\n=== {name} / {arm} / {latest.stamp} ===")
            if not result["ok"]:
                print(f"  cannot train: {result['reason']}")
                continue
            ev = result["evaluation"]
            print(f"  classes  : {result['classes']}")
            print(f"  windows  : {result['n_windows']}")
            if ev.get("available"):
                print(f"  method   : {ev['method']}, {ev['folds']} folds")
                print(f"  accuracy : {ev['accuracy']*100:.1f}%  "
                      f"(held-out repetitions only)")
                if ev.get("false_fire_rate") is not None:
                    print(f"  FALSE FIRE RATE: {ev['false_fire_rate']*100:.2f}% "
                          f"of rest/movement windows misread as a signal")
                for label, stats in ev["per_class"].items():
                    print(f"    {label[:34]:34} recall {stats['recall']*100:5.1f}%  "
                          f"precision {stats['precision']*100:5.1f}%  "
                          f"n={stats['support']}")
            else:
                print(f"  evaluation: {ev.get('note')}")
            op = result["operating_point"]
            if op.get("available"):
                print(f"  OPERATING POINT (chosen to meet a "
                      f"{op['target_false_fire']*100:.0f}% false-fire budget):")
                print(f"    fire only above confidence {op['confidence_threshold']}")
                print(f"    -> false fires {op['false_fire_rate']*100:.2f}% "
                      f"per window, catches {op['signal_recall']*100:.0f}% "
                      f"of real attempts")
                print(f"    -> hold {op['hold_time_s']}s ({op['hold_windows']} "
                      f"windows) for {op['projected_false_fire']*100:.4f}% "
                      f"projected false fires")
            else:
                print(f"  operating point: {op.get('note')}")
            path = result["model"].save(profile.model_metrics_path(arm))
            print(f"  saved    : {os.path.relpath(path)}")
            reloaded = LinearModel.load(path)
            print(f"  reload ok: {reloaded is not None and reloaded.classes == result['classes']}")
