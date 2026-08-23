"""The in-app guide: what just happened, and what to do next.

Factum is not a data-collection interface. It exists to answer one
question — **which of Kyle's signals can drive a mouse reliably** — and
every screen should make progress toward that answer visible.

So this module turns the numbers into two sentences and a checklist:

    what just happened   "Your rest is 23% quieter than the last one —
                          a cleaner baseline makes every movement
                          easier to detect."
    what to do next      "Record an everyday-movement sample."
    how far along        6 concrete steps to a usable mouse click.

All of it is local and rule-based. It works with no internet, no API
key, and no model — the AI assistant, when it arrives, is a second
opinion on top of this, never a prerequisite for it. The person in the
rehab room needs to be told what to do whether or not there is Wi-Fi.

Nothing here computes anything new. It reads what `analysis` and
`calibrate` already produced and says it in English.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

# The goal, broken into things that can be checked off. This is the
# spine of the whole app: every step is a prerequisite for a reliable
# mouse click, in the order they have to happen.
GOAL = "Kyle drives a mouse click with a signal that never fires by accident"

STEP_REST = "rest"
STEP_REST2 = "rest2"
STEP_MOVE = "move"
STEP_NOISE = "noise"
STEP_SEPARATES = "separates"
STEP_REPEATS = "repeats"


def _pct(a: float, b: float) -> float:
    """Percentage change from b to a, guarded against a zero baseline."""
    if not b:
        return 0.0
    return (a - b) / b * 100.0


def last_probe_verdict(entry: Dict[str, Any],
                       previous: Optional[Dict[str, Any]] = None) -> str:
    """Plain-language readout of the recording that just finished."""
    if not entry:
        return ""
    metrics = entry.get("metrics") or {}
    kind = entry.get("kind", "probe")
    name = entry.get("probe", "that")

    if kind in ("rest", "baseline"):
        rms = metrics.get("rms") or []
        level = sum(rms) / len(rms) if rms else None
        if previous:
            prev_rms = (previous.get("metrics") or {}).get("rms") or []
            prev_level = sum(prev_rms) / len(prev_rms) if prev_rms else None
            if level is not None and prev_level:
                change = _pct(level, prev_level)
                if change <= -10:
                    return (f"Baseline saved — and it is {abs(change):.0f}% "
                            f"quieter than the last one. A cleaner baseline "
                            f"makes every real movement easier to pick out.")
                if change >= 15:
                    return (f"Baseline saved, but it is {change:.0f}% noisier "
                            f"than the last one. Check the arm is supported "
                            f"and the band has not shifted — a noisy baseline "
                            f"hides weak movements.")
                return ("Baseline saved, in line with the last one. "
                        "Consistent baselines are what let us compare days.")
        if level is not None:
            return (f"Baseline saved (level {level:.3f}). Everything else "
                    f"this session is measured against it.")
        return "Baseline saved."

    if kind == "distractor":
        return ("Everyday-movement sample saved. This is the negative "
                "example — it is what proves a trigger will not fire while "
                "he is just moving his arm around.")

    # A movement probe.
    bits: List[str] = []
    if metrics.get("cued"):
        got, want = metrics.get("n_reps_with_signal", 0), metrics.get("n_reps_cued", 0)
        if want and got == want:
            bits.append(f"all {want} cued attempts produced a signal")
        elif want:
            bits.append(f"only {got} of {want} cued attempts produced a signal")
    consistency = metrics.get("consistency")
    if consistency is not None:
        if consistency >= 0.80:
            bits.append(f"and they looked very alike ({consistency:.2f})")
        elif consistency >= 0.65:
            bits.append(f"and they were reasonably alike ({consistency:.2f})")
        else:
            bits.append(f"but they varied a lot ({consistency:.2f}) — "
                        f"hard to detect reliably")
    db = metrics.get("best_channel_db")
    if db is not None:
        bits.append(f"strongest on ch{(metrics.get('best_channel') or 0) + 1} "
                    f"at {db:+.0f} dB above rest")
    if not bits:
        return f"'{name}' saved."
    return f"'{name}': " + ", ".join(bits) + "."


def progress(session, calibration: Dict[str, Any],
             history_probe_names: Optional[set] = None) -> List[Dict[str, Any]]:
    """The checklist to a usable mouse click, with each step's status."""
    probes = session.active_probes() if session else []
    rests = [p for p in probes if p.get("kind") in ("rest", "baseline")]
    moves = [p for p in probes
             if p.get("kind") not in ("rest", "baseline", "distractor")]
    noise = [p for p in probes if p.get("kind") == "distractor"]

    trigger = (calibration or {}).get("trigger", {}) or {}
    candidates = trigger.get("candidates", []) if trigger.get("available") else []
    safe = [c for c in candidates if c.get("safe")]

    repeated = set()
    if history_probe_names:
        repeated = {p.get("probe", "").strip().lower() for p in moves} & history_probe_names

    steps = [
        {
            "key": STEP_REST, "label": "Record a rest baseline",
            "done": bool(rests),
            "detail": "Everything is measured against it.",
        },
        {
            "key": STEP_REST2, "label": "Record rest a second time",
            "done": len(rests) >= 2,
            "detail": "Two baselines let the app measure how much the signal "
                      "drifts on its own — the floor below which nothing is "
                      "a real difference.",
        },
        {
            "key": STEP_MOVE, "label": "Record a candidate movement",
            "done": bool(moves),
            "detail": "Anything he can attempt repeatably.",
        },
        {
            "key": STEP_NOISE, "label": "Record everyday movement (no attempt)",
            "done": bool(noise),
            "detail": "The only way to measure false fires.",
        },
        {
            "key": STEP_SEPARATES,
            "label": "Find a movement that beats everyday movement",
            "done": bool(safe),
            "detail": (f"{len(safe)} of {len(candidates)} candidates clear the bar"
                       if candidates else
                       "needs both a movement and an everyday-movement sample"),
        },
        {
            "key": STEP_REPEATS, "label": "Confirm it repeats on another day",
            "done": bool(repeated),
            "detail": "A signal that only works once is not a mouse button.",
        },
    ]
    return steps


def next_action(session, calibration: Dict[str, Any], live: bool,
                steps: List[Dict[str, Any]]) -> Tuple[str, str]:
    """(what to do now, why) — exactly one instruction, never a menu."""
    if not live:
        return ("Get a signal first.",
                "Open Mudra Link and connect the band. The app connects by "
                "itself once the band is up.")

    pending = [s for s in steps if not s["done"]]
    if not pending:
        trigger = (calibration or {}).get("trigger", {}) or {}
        safe = [c for c in trigger.get("candidates", []) if c.get("safe")]
        best = safe[0] if safe else None
        if best:
            return (f"You have a usable trigger: '{best['probe']}'.",
                    f"It separates from ordinary movement at d'="
                    f"{best['d_prime_vs_movement']}, and held for "
                    f"{best['hold_time_s']}s it would fire by accident about "
                    f"{best['projected_false_fire']*100:.2f}% of the time. "
                    f"Next: record it on another day to confirm, then bind it "
                    f"to a mouse click.")
        return ("Everything on the checklist is done.", "")

    step = pending[0]
    prompts = {
        STEP_REST: ("Record a rest baseline.",
                    "Forearm flat and supported, completely relaxed. This is "
                    "the reference for everything else in the session."),
        STEP_REST2: ("Record rest one more time.",
                     "Two baselines let the app work out how much the signal "
                     "wanders on its own. Without that, it cannot tell a real "
                     "difference from drift."),
        STEP_MOVE: ("Record a movement he can repeat.",
                    "Name it in his own words. The app cues five attempts — "
                    "just follow the green band."),
        STEP_NOISE: ("Record 'Everyday movement (NO attempt)'.",
                     "Move the arm around normally — reach, rotate, scratch — "
                     "without attempting the trigger once. This is what "
                     "measures false fires, and nothing else can."),
        STEP_SEPARATES: ("Try a more distinct movement.",
                         "Nothing recorded so far stands far enough apart from "
                         "ordinary arm movement to be safe as a trigger. Look "
                         "for something that feels different, not just stronger."),
        STEP_REPEATS: ("Close the session, then record again another day.",
                       "The same movement on a different day, with the band "
                       "re-placed, is the real test."),
    }
    return prompts.get(step["key"], (step["label"], step["detail"]))


# ============================================================ walkthrough
#
# "What do I actually do?" — answered for the specific recording that is
# about to happen, before it happens.
#
# The next-action headline says *which* recording to make. That is not
# the same as knowing how to make it. Someone standing over a person's
# arm needs to know what to set up, what will appear on screen, how long
# it lasts, and what to write down afterwards — and they need it before
# they press the button, not as an overlay they are reading for the
# first time while the countdown runs.
#
# Every string here is written for a helper in a rehab room who has
# never seen this app. No metric names, no jargon, no "d-prime".

_SETUP_COMMON = [
    ("Band in place",
     "Three electrodes flat against the skin, snug but not tight. If it "
     "has been on for a while, check it has not rotated."),
]

_AFTER_COMMON = [
    ("Rate it, in his words",
     "How hard it was, whether it tired him, and how much the attempts "
     "felt the same. Then write what you SAW and what he SAID — "
     "\"band slipped\", \"he had to concentrate\", \"said that one was "
     "easy\". Those notes explain the numbers later when nobody "
     "remembers the room."),
]


def walkthrough(protocol_key: str, probe_name: str = "",
                n_reps: int = 5, hold_s: float = 2.0,
                duration_s: float = 30.0) -> List[Dict[str, Any]]:
    """Numbered steps for the recording about to be made.

    Returns a list of {"phase", "title", "detail"} — phase is one of
    "before" / "during" / "after", so the UI can group them.
    """
    movement = (probe_name or "the movement").strip() or "the movement"

    before: List[Tuple[str, str]] = list(_SETUP_COMMON)
    during: List[Tuple[str, str]] = []

    if protocol_key == "rest":
        before.append((
            "Arm supported and slack",
            "Forearm resting on the table or an armrest. He should not be "
            "holding it up — holding an arm up is itself a muscle signal, "
            "and it would end up in the baseline everything is compared "
            "against."))
        before.append((
            "Nothing to attempt",
            "This recording is the quiet. He does nothing at all for "
            f"{duration_s:.0f} seconds."))
        during.append((
            "Stay still, stay quiet",
            "Talking, laughing and shifting in the chair all show up. If "
            "something disturbs it, let it finish and record another — "
            "they are cheap, and the app keeps both."))
    elif protocol_key == "distractor":
        before.append((
            "This one is the opposite of a test",
            "He must NOT attempt any trigger movement, not even once. "
            "This recording is what proves a trigger will not fire while "
            "he is just living his life."))
        before.append((
            "Decide what 'ordinary' means",
            "Reaching, rotating the wrist, scratching, resting the arm, "
            "picking something up. Real everyday movement — not a "
            "demonstration of moving."))
        during.append((
            "Move normally the whole time",
            f"Keep it varied for the full {duration_s:.0f} seconds. Dead "
            f"time here weakens the comparison."))
    else:
        before.append((
            f"Agree what “{movement}” means",
            "Say it back to him and have him do it once, untimed, so you "
            "both mean the same thing. Half of all wasted recordings are "
            "two different movements under one name."))
        if protocol_key == "sustained":
            during.append((
                "One long hold",
                f"On GO he attempts {movement} and holds it — steady, not "
                f"building. The screen shows the time remaining."))
            during.append((
                "Let it fade if it fades",
                "Do not prompt him to push harder when it starts to slip. "
                "Whether the signal holds or decays IS the result — this "
                "recording exists to find out which."))
        elif protocol_key == "ramp":
            during.append((
                "Three efforts: gentle, medium, hard",
                "The screen names each one. The point is whether effort "
                "changes the signal, so the difference between them "
                "matters more than how hard the hard one is."))
        else:
            during.append((
                f"{n_reps} attempts, one at a time",
                f"The screen turns green and says GO. He attempts "
                f"{movement} and holds it for about {hold_s:.0f} seconds, "
                f"then relaxes completely until the next GO."))
        if protocol_key != "sustained":
            during.append((
                "Complete stillness between attempts",
                "The gap is what separates one attempt from the next. If "
                "he trails off slowly, or fidgets in the gap, two attempts "
                "merge into one and the recording is worth less."))
            during.append((
                "Missed one? Keep going",
                "Do not restart and do not try to catch up. An attempt "
                "that produced nothing is a real finding — it says the "
                "movement is not reliable yet, which is exactly what we "
                "are here to learn."))

    during.append((
        "Watch him, not the screen",
        "The app records the signal. Only you can see the band slip, the "
        "wince, or the wrong movement — and only if you are looking."))

    steps = [{"phase": "before", "title": t, "detail": d} for t, d in before]
    steps += [{"phase": "during", "title": t, "detail": d} for t, d in during]
    steps += [{"phase": "after", "title": t, "detail": d}
              for t, d in _AFTER_COMMON]
    return steps


def walkthrough_headline(protocol_key: str, probe_name: str = "") -> str:
    """One line naming what this recording is for."""
    movement = (probe_name or "this movement").strip() or "this movement"
    return {
        "rest": "Capturing the quiet, so every movement can be measured "
                "against it.",
        "distractor": "Capturing ordinary movement, so we can prove a "
                      "trigger will not fire on it.",
        "sustained": f"Finding out whether he can HOLD “{movement}”, "
                     f"not just start it.",
        "ramp": f"Finding out whether effort changes what "
                f"“{movement}” looks like.",
    }.get(protocol_key,
          f"Finding out whether “{movement}” comes out the same "
          f"way every time.")


# Things worth attempting, roughly ordered by how independent the
# underlying muscle groups are. There is still no fixed movement list in
# the app — this is a prompt for someone who has run out of ideas, not a
# menu to work through, and anything he comes up with himself beats
# everything on it.
SUGGESTIONS: List[Tuple[str, str]] = [
    ("curl index finger",   "flexor digitorum, mid-forearm — usually the "
                            "cleanest single-digit signal"),
    ("curl little finger",  "ulnar side — often separates well from index"),
    ("clench whole fist",   "strong and easy, but tends to look like "
                            "everything else"),
    ("bend wrist up",       "extensors, back of the forearm — a different "
                            "muscle group entirely"),
    ("bend wrist down",     "flexors, underside — the opposite pair"),
    ("rotate palm up",      "supinator — deep, and usually distinct"),
    ("spread fingers",      "interossei — weak, but very different in shape"),
    ("press thumb down",    "thenar group — separate from the finger flexors"),
]


def suggest_movements(session, limit: int = 3) -> List[Tuple[str, str]]:
    """What to try next, skipping anything already recorded this session.

    Ordered to favour muscle groups that are anatomically distinct from
    each other. Two movements driven by the same muscle will look the
    same however different they feel, which is the single most common
    way to waste a session.
    """
    seen = set()
    if session:
        for entry in session.active_probes():
            name = (entry.get("probe") or "").strip().lower()
            if name:
                seen.add(name)
    out = [(name, why) for name, why in SUGGESTIONS if name.lower() not in seen]
    return out[:limit]


def summarise(session, calibration: Dict[str, Any], live: bool,
              last_entry: Optional[Dict[str, Any]] = None,
              previous_entry: Optional[Dict[str, Any]] = None,
              history_probe_names: Optional[set] = None) -> Dict[str, Any]:
    """Everything the guidance panel needs, in one call."""
    steps = progress(session, calibration, history_probe_names)
    headline, because = next_action(session, calibration, live, steps)
    done = sum(1 for s in steps if s["done"])
    pending = [s for s in steps if not s["done"]]
    # Only offer ideas when the next thing to do is "record a movement" —
    # a suggestion list on every screen is noise.
    suggestions = (suggest_movements(session)
                   if pending and pending[0]["key"] in (STEP_MOVE, STEP_SEPARATES)
                   else [])
    return {
        "goal":        GOAL,
        "headline":    headline,
        "because":     because,
        "suggestions": suggestions,
        "last_result": last_probe_verdict(last_entry, previous_entry) if last_entry else "",
        "steps":       steps,
        "done":        done,
        "total":       len(steps),
        "fraction":    done / len(steps) if steps else 0.0,
    }


if __name__ == "__main__":
    import os
    import sys

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import calibrate
    from profiles import ProfileStore

    store = ProfileStore()
    for name in (sys.argv[1:] or store.list_profiles()):
        profile = store.load(name)
        for arm in ("left", "right"):
            sessions = [s for s in profile.sessions(arm) if s.active_probes()]
            if not sessions:
                continue
            sess = sessions[-1]
            cal = calibrate.load(profile, arm)
            probes = sess.active_probes()
            state = summarise(sess, cal, live=True,
                              last_entry=probes[-1] if probes else None,
                              previous_entry=probes[-2] if len(probes) > 1 else None)
            print(f"\n=== {name} / {arm} / {sess.stamp} ===")
            print(f"GOAL: {state['goal']}")
            print(f"\nJUST NOW: {state['last_result']}")
            print(f"\nDO NEXT : {state['headline']}")
            print(f"  why   : {state['because']}")
            print(f"\nPROGRESS {state['done']}/{state['total']}")
            for s in state["steps"]:
                print(f"  [{'x' if s['done'] else ' '}] {s['label']}")
                print(f"      {s['detail']}")
