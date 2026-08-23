"""Model selection, a model registry, and the learning curve.

Three jobs, all in service of one claim: **the more sessions we record,
the more reliable this gets.** That claim is plausible, universally
believed, and worth checking rather than assuming — because the day it
stops being true is the day more recording sessions stop being the
right thing to ask of Kyle, and something else becomes the bottleneck.

Model selection
---------------
Rather than one hand-chosen configuration, try several and keep the
best. Candidates vary the feature set and the regularisation. Selection
is by a **cost that reflects what actually matters**, not raw accuracy:
a model that never false-fires but catches half the attempts beats one
that catches everything and fires while he scratches his arm.

Model registry
--------------
Every trained model is kept, with its metrics, under `models/`. So:

* improvement across sessions is visible rather than anecdotal,
* a regression can be spotted and the previous model restored,
* and a model that made a clinical decision can be reconstructed
  exactly, which is the whole point of keeping records.

Learning curve
--------------
Train on 1 repetition per class, then 2, then 3... and plot held-out
performance against how much data was used. A curve still climbing at
the right-hand edge means more sessions will help. A flat one means
they will not, and the limit is placement, the movement choice, or the
feature set instead.
"""

from __future__ import annotations

import datetime as dt
import json
import os
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np

import features as feat
import model as model_mod

REGISTRY_SCHEMA = "armband/model-registry/1"
REGISTRY_DIR = "models"

# Configurations to try. Deliberately small — this runs on a laptop in a
# rehab room, and an exhaustive search would buy accuracy we cannot
# measure reliably from this much data anyway.
CANDIDATES: List[Dict[str, Any]] = [
    {"feature_version": "v2", "shrinkage": 0.15},
    {"feature_version": "v2", "shrinkage": 0.35},
    {"feature_version": "v2", "shrinkage": 0.05},
    {"feature_version": "v1", "shrinkage": 0.15},
]

FALSE_FIRE_BUDGET = 0.01


def _now() -> str:
    return dt.datetime.now().strftime("%Y-%m-%dT%H:%M:%S")


def selection_cost(evaluation: Dict[str, Any],
                   operating: Dict[str, Any]) -> float:
    """Lower is better. Encodes what we actually care about.

    False fires are weighted an order of magnitude above missed
    detections. A missed click is repeated; a spurious click while he is
    doing something else is the failure that makes him stop trusting
    the whole system, and trust does not come back easily.
    """
    if not evaluation.get("available"):
        return float("inf")
    false_fire = operating.get("false_fire_rate")
    if false_fire is None:
        false_fire = evaluation.get("false_fire_rate") or 1.0
    recall = operating.get("signal_recall")
    if recall is None:
        recall = evaluation.get("signal_recall") or 0.0
    over_budget = max(0.0, false_fire - FALSE_FIRE_BUDGET)
    return 10.0 * over_budget + 1.0 * (1.0 - recall)


def select(session, extra_sessions: Optional[Sequence[Any]] = None,
           candidates: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    """Train every candidate, return the best plus the full comparison."""
    tried: List[Dict[str, Any]] = []
    best: Optional[Dict[str, Any]] = None

    for candidate in (candidates or CANDIDATES):
        version = candidate.get("feature_version", feat.DEFAULT_VERSION)
        shrinkage = candidate.get("shrinkage", model_mod.SHRINKAGE)
        result = model_mod.train(session, extra_sessions=extra_sessions,
                                 feature_version=version, shrinkage=shrinkage)
        if not result.get("ok"):
            tried.append({**candidate, "ok": False,
                          "reason": result.get("reason")})
            continue

        evaluation = result["evaluation"]
        operating = result["operating_point"]
        cost = selection_cost(evaluation, operating)
        row = {
            **candidate,
            "ok": True,
            "cost": round(cost, 4),
            "accuracy": evaluation.get("accuracy"),
            "signal_recall": evaluation.get("signal_recall"),
            "false_fire_rate": operating.get("false_fire_rate",
                                             evaluation.get("false_fire_rate")),
            "recall_at_operating_point": operating.get("signal_recall"),
            "confidence_threshold": operating.get("confidence_threshold"),
            "hold_time_s": operating.get("hold_time_s"),
        }
        tried.append(row)
        if best is None or cost < best["cost"]:
            best = {**row, "result": result}

    if best is None:
        return {"ok": False, "tried": tried,
                "reason": "no candidate could be trained"}
    return {"ok": True, "best": best, "tried": tried,
            "model": best["result"]["model"],
            "evaluation": best["result"]["evaluation"],
            "operating_point": best["result"]["operating_point"]}


# =============================================================== registry


def registry_dir(profile, arm: str) -> str:
    return os.path.join(profile.arm_dir(arm), REGISTRY_DIR)


def registry_index_path(profile, arm: str) -> str:
    return os.path.join(registry_dir(profile, arm), "index.json")


def load_registry(profile, arm: str) -> Dict[str, Any]:
    path = registry_index_path(profile, arm)
    if not os.path.exists(path):
        return {"schema": REGISTRY_SCHEMA, "arm": arm, "models": []}
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        data.setdefault("models", [])
        return data
    except Exception:
        return {"schema": REGISTRY_SCHEMA, "arm": arm, "models": []}


def register(profile, arm: str, model, evaluation: Dict[str, Any],
             operating: Dict[str, Any], session_stamp: str,
             comparison: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    """Archive a trained model and record how it compares to its predecessor."""
    directory = registry_dir(profile, arm)
    os.makedirs(directory, exist_ok=True)
    index = load_registry(profile, arm)
    version = len(index["models"]) + 1
    filename = f"model_{version:03d}_{session_stamp}.json"
    model.save(os.path.join(directory, filename))

    previous = index["models"][-1] if index["models"] else None
    entry = {
        "version":        version,
        "file":           filename,
        "trained":        _now(),
        "session":        session_stamp,
        "feature_version": getattr(model, "feature_version", "v1"),
        "classes":        list(model.classes),
        "accuracy":       evaluation.get("accuracy"),
        "signal_recall":  evaluation.get("signal_recall"),
        "false_fire_rate": operating.get("false_fire_rate"),
        "recall_at_operating_point": operating.get("signal_recall"),
        "confidence_threshold": operating.get("confidence_threshold"),
        "hold_time_s":    operating.get("hold_time_s"),
        "n_windows":      (model.metadata or {}).get("n_windows"),
        "candidates_tried": comparison or [],
    }
    if previous:
        entry["change"] = {
            "accuracy": _delta(entry["accuracy"], previous.get("accuracy")),
            "recall": _delta(entry["recall_at_operating_point"],
                             previous.get("recall_at_operating_point")),
            "false_fire": _delta(entry["false_fire_rate"],
                                 previous.get("false_fire_rate")),
            "vs_version": previous["version"],
        }
        entry["regression"] = _is_regression(entry, previous)
    index["models"].append(entry)
    index["schema"] = REGISTRY_SCHEMA
    index["arm"] = arm
    index["updated"] = _now()

    tmp = registry_index_path(profile, arm) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(index, f, indent=2, sort_keys=True)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, registry_index_path(profile, arm))
    return entry


def _delta(now: Optional[float], before: Optional[float]) -> Optional[float]:
    if now is None or before is None:
        return None
    return round(float(now) - float(before), 4)


def _is_regression(entry: Dict[str, Any], previous: Dict[str, Any]) -> bool:
    """Worse where it counts: more false fires, or materially less recall."""
    now_ff = entry.get("false_fire_rate")
    was_ff = previous.get("false_fire_rate")
    if now_ff is not None and was_ff is not None and now_ff > was_ff + 0.005:
        return True
    now_r = entry.get("recall_at_operating_point")
    was_r = previous.get("recall_at_operating_point")
    if now_r is not None and was_r is not None and now_r < was_r - 0.10:
        return True
    return False


def history(profile, arm: str) -> List[Dict[str, Any]]:
    return load_registry(profile, arm).get("models", [])


def restore(profile, arm: str, version: int) -> Optional[str]:
    """Make an archived model the active one again."""
    for entry in history(profile, arm):
        if entry["version"] == version:
            source = os.path.join(registry_dir(profile, arm), entry["file"])
            restored = model_mod.LinearModel.load(source)
            if restored is None:
                return None
            return restored.save(profile.model_metrics_path(arm))
    return None


# ========================================================== learning curve


def learning_curve(session, extra_sessions: Optional[Sequence[Any]] = None,
                   feature_version: str = feat.DEFAULT_VERSION,
                   steps: int = 5) -> Dict[str, Any]:
    """Held-out performance as a function of how much data was used.

    Repetitions are added whole and in recording order, because that is
    how data actually arrives — sampling randomly would answer a
    question nobody is asking.
    """
    X, y, groups, _info = model_mod.build_dataset(
        session, None, extra_sessions, feature_version)
    if X.shape[0] == 0:
        return {"available": False, "note": "no data"}

    y_arr = np.asarray(y)
    g_arr = np.asarray(groups)
    signal_groups = sorted({g for g, label in zip(groups, y)
                            if label not in model_mod.REJECT_CLASSES})
    if len(signal_groups) < 3:
        return {"available": False,
                "note": f"only {len(signal_groups)} attempt repetitions — "
                        f"needs at least 3 before a trend means anything"}

    points: List[Dict[str, Any]] = []
    counts = sorted({max(2, round(len(signal_groups) * (i + 1) / steps))
                     for i in range(steps)})
    for count in counts:
        keep_signal = set(signal_groups[:count])
        mask = np.array([
            (g in keep_signal) or (label in model_mod.REJECT_CLASSES)
            for g, label in zip(g_arr, y_arr)])
        if mask.sum() < 10:
            continue
        evaluation = model_mod.cross_validate(X[mask], y_arr[mask], g_arr[mask])
        operating = model_mod.choose_operating_point(X[mask], y_arr[mask], g_arr[mask])
        points.append({
            "repetitions":    count,
            "windows":        int(mask.sum()),
            "accuracy":       evaluation.get("accuracy"),
            "signal_recall":  evaluation.get("signal_recall"),
            "false_fire_rate": operating.get("false_fire_rate"),
            "recall_at_operating_point": operating.get("signal_recall"),
        })

    verdict, still_improving = _curve_verdict(points)
    return {
        "available":       True,
        "feature_version": feature_version,
        "total_repetitions": len(signal_groups),
        "points":          points,
        "still_improving": still_improving,
        "verdict":         verdict,
    }


def _curve_verdict(points: List[Dict[str, Any]]) -> Tuple[str, Optional[bool]]:
    usable = [p for p in points if p.get("signal_recall") is not None]
    if len(usable) < 3:
        return ("Not enough points yet to see a trend — record more "
                "repetitions.", None)
    first_half = usable[:max(len(usable) // 2, 1)]
    second_half = usable[len(usable) // 2:]
    early = float(np.mean([p["signal_recall"] for p in first_half]))
    late = float(np.mean([p["signal_recall"] for p in second_half]))
    gain = late - early
    last_two = usable[-2:]
    recent = last_two[-1]["signal_recall"] - last_two[0]["signal_recall"]

    if gain > 0.05 and recent > 0.01:
        return (f"Still improving — recall rose {gain*100:.0f} points as data "
                f"was added, and was still climbing at the last step. More "
                f"sessions are the highest-value thing to do next.", True)
    if gain > 0.05:
        return (f"Improved {gain*100:.0f} points with more data, but the curve "
                f"is flattening. More sessions will still help, with "
                f"diminishing returns.", True)
    return ("Flat — more repetitions of the same kind are not buying "
            "accuracy. The limit is elsewhere: band placement, the choice "
            "of movement, or the features. Try a different movement rather "
            "than more of the same.", False)


# ============================================================== driver


def train_and_register(profile, arm: str, session,
                       extra_sessions: Optional[Sequence[Any]] = None,
                       compute_curve: bool = True) -> Dict[str, Any]:
    """Select, save, archive, and measure the learning curve. One call."""
    selection = select(session, extra_sessions)
    if not selection.get("ok"):
        return selection

    model = selection["model"]
    model.save(profile.model_metrics_path(arm))
    entry = register(profile, arm, model, selection["evaluation"],
                     selection["operating_point"],
                     getattr(session, "stamp", ""),
                     comparison=selection["tried"])
    curve = (learning_curve(session, extra_sessions,
                            getattr(model, "feature_version", feat.DEFAULT_VERSION))
             if compute_curve else {"available": False})
    profile.log(
        f"model v{entry['version']} trained for {arm}: "
        f"{entry['feature_version']}, recall "
        f"{(entry.get('recall_at_operating_point') or 0)*100:.0f}%, "
        f"false fires {(entry.get('false_fire_rate') or 0)*100:.2f}%",
        action="model.train", arm=arm, version=entry["version"])
    return {"ok": True, "entry": entry, "selection": selection,
            "curve": curve, "model": model}


# --------------------------------------------------------------- self-test

if __name__ == "__main__":
    import sys

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from profiles import ProfileStore

    store = ProfileStore()
    for name in (sys.argv[1:] or store.list_profiles()):
        try:
            profile = store.load(name)
        except Exception:
            continue
        for arm in ("left", "right"):
            sessions = [s for s in profile.sessions(arm) if s.probes()]
            if len(sessions) < 1:
                continue
            print(f"\n=== {name} / {arm} ===")
            result = train_and_register(profile, arm, sessions[-1],
                                        extra_sessions=sessions[:-1])
            if not result.get("ok"):
                print(f"  {result.get('reason')}")
                continue

            print("  candidates tried:")
            for row in result["selection"]["tried"]:
                if not row.get("ok"):
                    print(f"    {row.get('feature_version'):3} "
                          f"shrink={row.get('shrinkage')}: {row.get('reason')}")
                    continue
                mark = " <-- chosen" if row["cost"] == result["selection"]["best"]["cost"] else ""
                print(f"    {row['feature_version']:3} shrink={row['shrinkage']:<5} "
                      f"cost={row['cost']:.3f}  acc={row['accuracy']*100:5.1f}%  "
                      f"recall@op={(row['recall_at_operating_point'] or 0)*100:5.1f}%  "
                      f"ff={(row['false_fire_rate'] or 0)*100:5.2f}%{mark}")

            entry = result["entry"]
            print(f"\n  registered as model v{entry['version']} "
                  f"({entry['file']})")
            if entry.get("change"):
                print(f"    vs v{entry['change']['vs_version']}: "
                      f"accuracy {entry['change']['accuracy']:+.3f}, "
                      f"recall {entry['change']['recall']:+.3f}, "
                      f"false fire {entry['change']['false_fire']:+.4f}"
                      + ("   REGRESSION" if entry.get("regression") else ""))

            curve = result["curve"]
            print("\n  learning curve:")
            if curve.get("available"):
                print(f"    {'reps':>5} {'windows':>8} {'accuracy':>9} "
                      f"{'recall':>8} {'false fire':>11}")
                for p in curve["points"]:
                    print(f"    {p['repetitions']:5} {p['windows']:8} "
                          f"{(p['accuracy'] or 0)*100:8.1f}% "
                          f"{(p['signal_recall'] or 0)*100:7.1f}% "
                          f"{(p['false_fire_rate'] or 0)*100:10.2f}%")
                print(f"\n    {curve['verdict']}")
            else:
                print(f"    {curve.get('note')}")
