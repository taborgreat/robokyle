"""Automatic per-recording quality assessment — evidence, not opinion.

Whether a recording was any good is not a judgement to leave to the
person in the room. They cannot see clipping, they cannot see that the
baseline drifted 3x since the last probe, and they certainly cannot see
that this attempt looks nothing like the four other times the same
movement was recorded. Asking them to decide means the decision gets
made on vibes, inconsistently, and usually too late.

So the system decides, from measurements, and shows its working.

Nothing is ever discarded
-------------------------
A flawed recording is still data. A band-slip has a signature; so does
a distracted attempt; so does mains interference. Dropping those files
would throw away the only examples of what "wrong" looks like, and
would quietly bias every summary toward the recordings that happened to
go well.

So this module **never removes anything**. It attaches:

    verdict   good | suspect | unusable
    score     0-1, how much to trust it
    flags     what specifically is wrong, each with the number behind it

Downstream code keeps analysing everything and reports the verdict
alongside, so a conclusion that rests on a suspect recording says so.
A human can still override — that override is recorded as an override,
with a reason, rather than masquerading as a fact.

The checks
----------
Environmental (the recording conditions were wrong):
  * clipping, channel dropout, channel collapse, mains interference
  * baseline drift — this probe's quiet parts against the session's rest

Behavioural (the attempt itself did not happen properly):
  * cue miss — cued attempts that produced no signal at all
  * internal inconsistency — the repetitions within one recording
    disagree wildly, which is the signature of a fluke rather than a
    movement

Contextual (it does not match its own history):
  * outlier — this recording sits far from other recordings of the same
    movement. One recording cannot be an outlier; it takes two to be
    unusual, and three before that means much.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np

GOOD = "good"
SUSPECT = "suspect"
UNUSABLE = "unusable"

# Handed to the assistant so it reads the `recording_quality` field the
# way the code means it. Written here, next to the checks themselves,
# so it cannot drift from what they actually do.
ASSISTANT_NOTE = """\
Every recording carries a `recording_quality` field: a verdict of good,
suspect or unusable, a 0-1 score, and the specific flags behind it.
These come from measurements on the signal — clipping, dead channels,
channel collapse, mains interference, baseline drift, cued attempts
that produced nothing, repetitions inside one recording that disagree,
and recordings that sit far from other takes of the same movement.

Two things to understand about them:

1. **Nothing is ever discarded.** A suspect or unusable recording is
   still analysed and still appears in the data you are given. The flag
   tells you what to distrust, not what to ignore. If a conclusion
   rests on a flagged recording, say so in your answer.

2. **The flags are a rule set, and you are not.** They catch what can
   be measured; they miss what needs judgement. A recording flagged
   only for mild clipping on a strong movement is usually fine. A
   recording that passed every check can still be worthless — for
   instance if the "everyday movement" sample was not actually everyday
   movement, or if the movement recorded is not the movement named.
   Disagree with the verdict when the evidence supports it, and say
   why."""

# Weight removed from the score by each flag. Environmental faults that
# destroy information cost more than behavioural ones that merely make a
# recording uninformative.
FLAG_COST = {
    "clipping":              0.45,
    "channel_dropout":       0.60,
    "channel_collapse":      0.30,
    "mains_interference":    0.20,
    "baseline_drift":        0.35,
    "cue_miss":              0.30,
    "internal_inconsistency": 0.30,
    "outlier":               0.25,
    "no_signal":             0.60,
    "too_short":             0.50,
    "assumed_sample_rate":   0.15,
}


class Flag:
    def __init__(self, key: str, severity: str, message: str, fix: str,
                 value: Optional[float] = None) -> None:
        self.key = key
        self.severity = severity        # "warn" | "bad"
        self.message = message
        self.fix = fix
        self.value = value

    def as_dict(self) -> Dict[str, Any]:
        return {"key": self.key, "severity": self.severity,
                "message": self.message, "fix": self.fix,
                "value": None if self.value is None else round(self.value, 4)}


def _ac(samples: np.ndarray) -> np.ndarray:
    return samples - samples.mean(axis=1, keepdims=True)


# ------------------------------------------------------------ environment


# Clipping tolerance depends entirely on what the recording is OF.
# A resting arm that touches the rails has a contact problem; a
# deliberate hard contraction that touches them briefly is just a
# strong signal. Judging both by the resting threshold condemned every
# real movement recording in the first version of this module.
CLIP_LIMITS = {
    "rest":       (0.005, 0.02),    # (warn, unusable)
    "baseline":   (0.005, 0.02),
    "distractor": (0.05,  0.25),
    "probe":      (0.05,  0.25),
}


def _environmental(samples: np.ndarray, fs: int,
                   rest: Optional[Dict[str, Any]],
                   kind: str = "probe") -> List[Flag]:
    import quality

    flags: List[Flag] = []
    assessment = quality.assess(samples, fs, calibration=None, at_rest=False)
    mapping = {"flatline": "channel_dropout", "collapse": "channel_collapse",
               "mains": "mains_interference"}
    for issue in assessment.get("issues", []):
        key = mapping.get(issue["key"])
        if key:
            flags.append(Flag(key, issue["severity"] if issue["severity"] != "ok"
                              else "warn", issue["message"], issue["fix"],
                              issue.get("value")))

    # Clipping, judged against what this kind of recording should look like.
    warn_at, bad_at = CLIP_LIMITS.get(kind, CLIP_LIMITS["probe"])
    fraction = np.mean(np.abs(samples) >= 0.999, axis=1)
    worst = int(np.argmax(fraction))
    value = float(fraction[worst])
    if value >= bad_at:
        flags.append(Flag(
            "clipping", "bad",
            f"ch{worst+1} is pinned at the rails for {value*100:.0f}% of the "
            f"recording",
            "That much clipping throws away the shape of the signal, not "
            "just its peaks. Loosen the band slightly and re-record.", value))
    elif value >= warn_at:
        flags.append(Flag(
            "clipping", "warn",
            f"ch{worst+1} clips on {value*100:.1f}% of samples"
            + (" — high for a rest recording" if kind in ("rest", "baseline")
               else " at the peaks"),
            "Some peak information is lost. Fine if the movement is strong; "
            "worth re-seating that electrode if it gets worse.", value))

    # Baseline drift: compare the QUIET part of this recording with the
    # session's rest. Using the whole recording would flag every strong
    # movement as drifted, which is the opposite of useful.
    if rest and rest.get("available") and samples.shape[1] > fs:
        from analysis import envelope

        env = envelope(samples, fs)
        quiet = np.percentile(env, 20, axis=1)
        reference = np.asarray(rest.get("rms", []), dtype=float)
        if reference.size == 3 and np.all(reference > 0):
            ratio = float(np.max(quiet / reference))
            if ratio >= 3.0:
                flags.append(Flag(
                    "baseline_drift", "bad",
                    f"the quiet parts of this recording sit {ratio:.1f}x "
                    f"above the session's rest level",
                    "The band has probably moved, or the arm was not "
                    "supported. Re-check placement and record rest again "
                    "before trusting comparisons with earlier probes.",
                    ratio))
            elif ratio >= 2.0:
                flags.append(Flag(
                    "baseline_drift", "warn",
                    f"quiet parts sit {ratio:.1f}x above the session's rest",
                    "Could be the band shifting or the arm tensing. Worth a "
                    "glance at placement.", ratio))
    return flags


# ------------------------------------------------------------- behaviour


def _behavioural(metrics: Dict[str, Any], kind: str) -> List[Flag]:
    flags: List[Flag] = []
    if kind in ("rest", "baseline", "distractor"):
        return flags

    if metrics.get("cued"):
        cued = metrics.get("n_reps_cued") or 0
        landed = metrics.get("n_reps_with_signal") or 0
        if cued and landed == 0:
            flags.append(Flag(
                "no_signal", "bad",
                f"none of the {cued} cued attempts produced any signal",
                "Either he did not attempt it, or the movement produces "
                "nothing detectable at this placement. Check the live meters "
                "before recording it again.", 0.0))
        elif cued and landed < cued * 0.6:
            flags.append(Flag(
                "cue_miss", "warn",
                f"only {landed} of {cued} cued attempts produced a signal",
                "He may be missing the cue, tiring, or unable to produce it "
                "on demand. Watch him during the next one.",
                landed / cued))

    consistency = metrics.get("consistency")
    reps = metrics.get("n_reps") or 0
    if consistency is not None and reps >= 3 and consistency < 0.45:
        flags.append(Flag(
            "internal_inconsistency", "warn",
            f"the repetitions within this recording disagree badly "
            f"(consistency {consistency:.2f})",
            "That pattern usually means a fluke rather than a movement — "
            "something different happened each time. Re-record before "
            "drawing any conclusion from it.", consistency))

    if metrics.get("duration_s", 0) and metrics["duration_s"] < 3:
        flags.append(Flag(
            "too_short", "bad",
            f"only {metrics['duration_s']:.1f}s long",
            "Probably stopped early. Too short to judge repeatability.",
            metrics["duration_s"]))
    return flags


# -------------------------------------------------------------- context


def _provenance(entry: Dict[str, Any]) -> List[Flag]:
    """Is anything about how this was recorded untrustworthy?

    Currently one check: whether the sample rate was measured or
    guessed. It is not a fault in the signal, so it never disqualifies
    a recording — but every frequency feature is computed against that
    number, and a guess is roughly 1-2% off at best and 19% off if the
    old hardcoded default ever landed. A future reader deserves to know
    which recordings carry it.
    """
    source = (entry.get("sample_rate_source")
              or (entry.get("meta") or {}).get("sample_rate_source"))
    if source == "assumed":
        return [Flag(
            "assumed_sample_rate", "warn",
            "The sample rate could not be measured when this started, so "
            "a typical value was assumed.",
            "The samples are fine. Frequency-based comparisons against "
            "other recordings are slightly off — check the stream was "
            "healthy before the next one.")]
    return []


def _contextual(entry: Dict[str, Any],
                siblings: Sequence[Dict[str, Any]]) -> List[Flag]:
    """Does this recording match other recordings of the same movement?

    Uses the feature means already stored per probe. A recording far
    from its own siblings is the signature of something having gone
    wrong that no single-recording check can see — a slipped band, a
    different movement performed under the same name, a bad day.
    """
    flags: List[Flag] = []
    mine = (entry.get("metrics") or {}).get("feature_mean")
    if not mine:
        return flags
    others = [(e.get("metrics") or {}).get("feature_mean") for e in siblings]
    others = [np.asarray(o, dtype=float) for o in others if o]
    # Two siblings minimum: with one, "far apart" is symmetric and says
    # nothing about which of the pair is the odd one out.
    if len(others) < 2:
        return flags

    mine_v = np.asarray(mine, dtype=float)
    if any(o.shape != mine_v.shape for o in others):
        return flags          # feature sets differ; not comparable

    group = np.vstack(others)
    centre = group.mean(axis=0)
    scale = group.std(axis=0)
    scale = np.where(scale > 0, scale, 1.0)
    # Distance in units of the group's own spread, per feature, then a
    # robust summary so one odd feature does not condemn a recording.
    deviation = float(np.median(np.abs((mine_v - centre) / scale)))
    if deviation >= 4.0:
        flags.append(Flag(
            "outlier", "bad",
            f"this recording sits {deviation:.1f} spreads away from the "
            f"other {len(others)} recordings of the same movement",
            "Something was different this time — placement, effort, or the "
            "movement itself. Compare the placement notes for those "
            "sessions.", deviation))
    elif deviation >= 2.5:
        flags.append(Flag(
            "outlier", "warn",
            f"somewhat unlike the other {len(others)} recordings of this "
            f"movement ({deviation:.1f} spreads out)",
            "Worth knowing before treating them as the same thing.",
            deviation))
    return flags


# ============================================================== assessment


def assess_probe(samples: np.ndarray, fs: int, metrics: Dict[str, Any],
                 entry: Dict[str, Any], kind: str = "probe",
                 rest: Optional[Dict[str, Any]] = None,
                 siblings: Optional[Sequence[Dict[str, Any]]] = None
                 ) -> Dict[str, Any]:
    """Score one recording. Never decides to discard it."""
    flags: List[Flag] = []
    if samples is not None and samples.shape[1] > 0:
        flags += _environmental(samples, fs, rest, kind)
    flags += _behavioural(metrics or {}, kind)
    flags += _contextual(entry or {}, siblings or [])
    flags += _provenance(entry or {})

    score = 1.0
    for flag in flags:
        cost = FLAG_COST.get(flag.key, 0.2)
        score -= cost if flag.severity == "bad" else cost * 0.5
    score = float(np.clip(score, 0.0, 1.0))

    # Some faults are categorical, not a matter of degree: a dead
    # electrode, a clipped channel, or an attempt that produced nothing
    # is unusable *as that probe* however the arithmetic lands. Leaving
    # the verdict to a score threshold put both of those a hair on the
    # wrong side of the line.
    disqualifying = {"channel_dropout", "clipping", "no_signal", "too_short"}
    if any(f.severity == "bad" and f.key in disqualifying for f in flags):
        verdict = UNUSABLE
    elif any(f.severity == "bad" for f in flags) and score < 0.45:
        verdict = UNUSABLE
    elif flags:
        verdict = SUSPECT
    else:
        verdict = GOOD

    return {
        "verdict": verdict,
        "score":   round(score, 3),
        "flags":   [f.as_dict() for f in flags],
        "headline": _headline(verdict, flags),
        "note": "Assessed automatically from the recording itself. Nothing "
                "is discarded — a suspect recording is still analysed, and "
                "conclusions that rest on one say so.",
    }


def _headline(verdict: str, flags: List[Flag]) -> str:
    if verdict == GOOD:
        return "Looks clean."
    worst = next((f for f in flags if f.severity == "bad"), flags[0])
    # Most flag messages are fragments ("ch2 clips on 7.2% of samples")
    # and need the full stop; a few are whole sentences already.
    message = worst.message.rstrip(".")
    if verdict == UNUSABLE:
        return f"Probably unusable — {message}."
    return f"Usable but flagged — {message}."


def summarise(entries: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    """Session-level view: how much of this data can be trusted."""
    assessed = [e for e in entries if (e.get("quality") or {}).get("verdict")]
    if not assessed:
        return {"available": False}
    counts = {GOOD: 0, SUSPECT: 0, UNUSABLE: 0}
    for entry in assessed:
        counts[entry["quality"]["verdict"]] = \
            counts.get(entry["quality"]["verdict"], 0) + 1
    flagged = [
        {"probe": e.get("probe"), "verdict": e["quality"]["verdict"],
         "headline": e["quality"]["headline"],
         "flags": [f["key"] for f in e["quality"]["flags"]]}
        for e in assessed if e["quality"]["verdict"] != GOOD
    ]
    mean_score = float(np.mean([e["quality"]["score"] for e in assessed]))
    return {
        "available": True,
        "counts": counts,
        "mean_score": round(mean_score, 3),
        "flagged": flagged,
        "headline": (f"{counts[GOOD]} of {len(assessed)} recordings look "
                     f"clean" + (f"; {len(flagged)} flagged" if flagged else "")),
    }


# --------------------------------------------------------------- self-test

if __name__ == "__main__":
    fs = 840
    rng = np.random.default_rng(0)
    n = fs * 20

    def show(label: str, samples, metrics, kind="probe", rest=None,
             entry=None, siblings=()):
        result = assess_probe(samples, fs, metrics, entry or {}, kind,
                              rest, siblings)
        print(f"{label:26} [{result['verdict']:8}] score {result['score']:.2f} "
              f"— {result['headline']}")
        for flag in result["flags"]:
            print(f"{'':28} · {flag['key']}: {flag['message']}")

    clean = rng.normal(0, 0.05, (3, n))
    clean[1] = rng.normal(0, 0.07, n)
    clean[2] = rng.normal(0, 0.06, n)
    rest = {"available": True, "rms": [0.05, 0.07, 0.06]}
    good_metrics = {"cued": True, "n_reps_cued": 5, "n_reps_with_signal": 5,
                    "consistency": 0.86, "n_reps": 5, "duration_s": 20.0}

    show("clean, all attempts", clean, good_metrics, rest=rest)

    show("he produced nothing", clean,
         {**good_metrics, "n_reps_with_signal": 0}, rest=rest)

    show("half the attempts", clean,
         {**good_metrics, "n_reps_with_signal": 2}, rest=rest)

    show("reps disagree (fluke)", clean,
         {**good_metrics, "consistency": 0.31}, rest=rest)

    drifted = clean * 4
    show("band slipped mid-probe", drifted, good_metrics, rest=rest)

    clipped = clean.copy()
    clipped[0] = np.clip(clipped[0] * 40, -1, 1)
    show("electrode clipping", clipped, good_metrics, rest=rest)

    dead = clean.copy()
    dead[2] = np.zeros(n)
    show("electrode fell off", dead, good_metrics, rest=rest)

    # Outlier against its own history.
    base = rng.normal(0, 1, 36)
    siblings = [{"metrics": {"feature_mean": (base + rng.normal(0, 0.1, 36)).tolist()}}
                for _ in range(4)]
    odd = {"metrics": {"feature_mean": (base + 9.0).tolist()}}
    show("unlike its own history", clean, good_metrics, rest=rest,
         entry=odd, siblings=siblings)

    print()
    print("summary of a mixed session:")
    entries = [
        {"probe": "curl index", "quality": assess_probe(clean, fs, good_metrics, {}, rest=rest)},
        {"probe": "clench", "quality": assess_probe(dead, fs, good_metrics, {}, rest=rest)},
        {"probe": "spread", "quality": assess_probe(clean, fs, {**good_metrics, "n_reps_with_signal": 2}, {}, rest=rest)},
    ]
    s = summarise(entries)
    print(" ", s["headline"], "| mean score", s["mean_score"])
    for f in s["flagged"]:
        print(f"   {f['probe']}: {f['verdict']} — {f['flags']}")
