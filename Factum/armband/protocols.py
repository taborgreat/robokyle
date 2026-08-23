"""Guided recording protocols — tell the person what to do, and when.

Before this, a probe was 30 seconds of "do the movement a few times"
and the analysis had to work out from the signal alone where one
attempt ended and the next began. That inference is the weakest link
in the whole chain: every consistency and separability number is built
on top of it, and it fails silently when someone holds one long
contraction instead of making five distinct ones.

Cueing the attempts removes the guesswork. The app says GO, the person
goes; the app says REST, they stop. The schedule is recorded alongside
the samples, so analysis knows where each attempt was *supposed* to be
and can compare that against what actually arrived. That comparison is
itself the most useful diagnostic we have:

    cued 5, detected 5  ->  he produced signal on every attempt
    cued 5, detected 2  ->  three attempts produced nothing

Which is a clinical finding, not a software problem — and it is
invisible without a cue schedule to compare against.

Every protocol is a list of `Phase`s with absolute start/end times.
The overlay renders the current phase; the analysis reads the "go"
phases as ground-truth attempt windows.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple

# Phase kinds. The UI colours on these; the analysis only cares about "go".
PREPARE = "prepare"      # get ready, do nothing yet
GO = "go"                # attempt the movement NOW
RELAX = "relax"          # deliberate stillness between attempts
STILL = "still"          # whole-recording stillness (rest probes)
MOVE = "move"            # ordinary arm movement, NOT a trigger attempt


@dataclass
class Phase:
    start_s: float
    end_s: float
    kind: str
    label: str
    detail: str = ""

    @property
    def duration_s(self) -> float:
        return self.end_s - self.start_s

    def contains(self, t: float) -> bool:
        return self.start_s <= t < self.end_s


@dataclass
class Protocol:
    key: str
    name: str                     # shown in the picker
    description: str              # one line, shown under the picker
    probe_kind: str               # "rest" | "probe" | "distractor"
    build: Callable[..., List[Phase]] = field(repr=False, default=None)  # type: ignore[assignment]
    cueing: bool = True           # False = one static instruction

    def phases(self, **params: Any) -> List[Phase]:
        return self.build(**params)  # type: ignore[misc]

    def duration_s(self, **params: Any) -> float:
        phases = self.phases(**params)
        return phases[-1].end_s if phases else 0.0


# ------------------------------------------------------------- builders


def _rest(duration_s: float = 30.0, **_: Any) -> List[Phase]:
    return [Phase(0.0, duration_s, STILL, "Stay completely still",
                  "Forearm supported. Let the arm go slack — do not hold it up.")]


def _reps(n_reps: int = 5, hold_s: float = 2.0, relax_s: float = 3.0,
          prepare_s: float = 3.0, movement: str = "the movement",
          **_: Any) -> List[Phase]:
    """The default: N cued attempts with deliberate stillness between."""
    phases = [Phase(0.0, prepare_s, PREPARE, "Get ready",
                    f"On GO, attempt {movement}. Hold it until RELAX.")]
    t = prepare_s
    for i in range(1, n_reps + 1):
        phases.append(Phase(t, t + hold_s, GO, f"GO — attempt {i} of {n_reps}",
                            f"Attempt {movement}. Hold."))
        t += hold_s
        phases.append(Phase(t, t + relax_s, RELAX, "Relax",
                            "Completely still. This gap is what separates "
                            "one attempt from the next."))
        t += relax_s
    return phases


def _ramp(hold_s: float = 4.0, relax_s: float = 3.0, prepare_s: float = 3.0,
          movement: str = "the movement", **_: Any) -> List[Phase]:
    """Graded effort — shows how much dynamic range there is to work with.

    If gentle and hard look the same, there is only one usable level and
    a proportional control is off the table.
    """
    phases = [Phase(0.0, prepare_s, PREPARE, "Get ready",
                    f"Three levels of effort for {movement}: gentle, "
                    f"medium, then as hard as you can.")]
    t = prepare_s
    for level, note in (("GENTLE", "barely there — the smallest attempt you can make"),
                        ("MEDIUM", "a comfortable, repeatable effort"),
                        ("HARD", "as strong as you can, briefly")):
        phases.append(Phase(t, t + hold_s, GO, f"GO — {level}", note))
        t += hold_s
        phases.append(Phase(t, t + relax_s, RELAX, "Relax", "Completely still."))
        t += relax_s
    return phases


def _sustained(hold_s: float = 15.0, relax_s: float = 6.0, prepare_s: float = 3.0,
               movement: str = "the movement", **_: Any) -> List[Phase]:
    """One long hold — does the signal fade while he is still trying?"""
    return [
        Phase(0.0, prepare_s, PREPARE, "Get ready",
              f"One long hold of {movement} — keep it going until RELAX."),
        Phase(prepare_s, prepare_s + hold_s, GO, "GO — hold it",
              "Keep the same effort. Do not let it fade."),
        Phase(prepare_s + hold_s, prepare_s + hold_s + relax_s, RELAX,
              "Relax", "Let it go completely."),
    ]


def _distractor(duration_s: float = 30.0, prepare_s: float = 3.0,
                **_: Any) -> List[Phase]:
    """Everyday movement with NO trigger attempt — the negative class.

    This is what stops false positives. A detector trained only on
    attempts has never seen ordinary movement and will happily fire on
    scratching, reaching or shifting in a chair. There is no way to
    learn "that is just movement" without recording some.

    Retained for backward compatibility. New sessions should use
    `distractor_daily` (the realistic operating-point class) and
    `distractor_extreme` (the artifact-ceiling class) — see below.
    """
    span = max(duration_s - prepare_s, 6.0)
    step = span / 4.0
    t = prepare_s
    cues = [
        ("Reach forward and back", "as if picking something up"),
        ("Rotate and shift the arm", "turn the forearm, move the elbow"),
        ("Scratch / adjust / fidget", "the ordinary things people do"),
        ("Rest the arm, then shift it", "settle, then reposition"),
    ]
    phases = [Phase(0.0, prepare_s, PREPARE, "Get ready",
                    "Move your arm NORMALLY. Do NOT attempt the trigger "
                    "movement at any point.")]
    for label, detail in cues:
        phases.append(Phase(t, t + step, MOVE, label,
                            f"{detail} — but no trigger attempt."))
        t += step
    return phases


def _distractor_daily(prepare_s: float = 3.0, cue_hold_s: float = 5.0,
                      cue_relax_s: float = 3.0, **_: Any) -> List[Phase]:
    """Realistic non-triggering activity — cued, so it labels cleanly.

    This is what a false activation actually looks like in daily use,
    and it is the recording that should drive the operating point.
    Cued structure lets grouped leave-one-repetition-out CV work on
    the negative side, which the old free-form distractor could not
    support. Recorded 2026-08-13 per user directive.
    """
    cues = [
        ("Reach for a cup", "reach forward and pick something up"),
        ("Type a few words", "keyboard typing motion"),
        ("Gesture while talking", "loose expressive hand motion"),
        ("Adjust glasses / hair", "small purposeful hand motion"),
        ("Turn a doorknob / handle", "wrist rotation with light grip"),
    ]
    phases = [Phase(0.0, prepare_s, PREPARE, "Get ready",
                    "You will be cued through everyday activities. "
                    "Do the activity when told; do NOT attempt the "
                    "trigger movement at any point.")]
    t = prepare_s
    for i, (label, detail) in enumerate(cues, 1):
        phases.append(Phase(t, t + cue_hold_s, MOVE, f"{label} ({i}/5)",
                            f"{detail} — no trigger attempt."))
        t += cue_hold_s
        phases.append(Phase(t, t + cue_relax_s, RELAX,
                            "Rest the arm",
                            "Completely still until the next cue."))
        t += cue_relax_s
    return phases


def _distractor_extreme(prepare_s: float = 3.0, cue_hold_s: float = 4.0,
                        cue_relax_s: float = 3.0, **_: Any) -> List[Phase]:
    """Deliberately vigorous movement — the artifact ceiling.

    Recorded so we know what the SNC + IMU pipeline looks like under
    the worst plausible motion, without letting those numbers set the
    operating point (that job belongs to distractor_daily). Kept as
    a separate protocol so it is impossible to accidentally mix them.
    """
    cues = [
        ("Wave the whole arm", "big wave, elbow moving"),
        ("Shake the arm loose", "as if flicking off water"),
        ("Fast reach and retract", "reach forward, snap back"),
        ("Rotate at the shoulder", "arm circles, full range"),
    ]
    phases = [Phase(0.0, prepare_s, PREPARE, "Get ready",
                    "Vigorous limb motion. Do NOT attempt the trigger "
                    "movement at any point.")]
    t = prepare_s
    for i, (label, detail) in enumerate(cues, 1):
        phases.append(Phase(t, t + cue_hold_s, MOVE, f"{label} ({i}/4)",
                            f"{detail} — no trigger attempt."))
        t += cue_hold_s
        phases.append(Phase(t, t + cue_relax_s, RELAX,
                            "Rest the arm",
                            "Completely still until the next cue."))
        t += cue_relax_s
    return phases


# ------------------------------------------------------------- registry

PROTOCOLS: Dict[str, Protocol] = {
    p.key: p for p in (
        Protocol("reps", "Repeated attempts (default)",
                 "Cued attempts with stillness between — the standard probe.",
                 "probe", _reps),
        Protocol("rest", "Rest / baseline",
                 "Stay still. Everything else is measured against this.",
                 "rest", _rest, cueing=False),
        Protocol("ramp", "Graded effort (gentle / medium / hard)",
                 "Shows how much dynamic range the movement has.",
                 "probe", _ramp),
        Protocol("sustained", "Sustained hold",
                 "One long contraction — does it fade while he is still trying?",
                 "probe", _sustained),
        Protocol("distractor", "Everyday movement (NO attempt)",
                 "Legacy: ordinary arm movement, free-form. Kept for "
                 "back-compat only — use distractor_daily instead.",
                 "distractor", _distractor),
        Protocol("distractor_daily", "Daily activity (cued, NO attempt)",
                 "Realistic non-triggering activity. Cued for grouped LORO. "
                 "Drives the operating point.",
                 "distractor", _distractor_daily),
        Protocol("distractor_extreme", "Vigorous motion (cued, NO attempt)",
                 "Deliberately vigorous limb motion. Cued for grouped LORO. "
                 "Reports the artifact ceiling; does NOT drive operating point.",
                 "distractor", _distractor_extreme),
    )
}

DEFAULT_KEY = "reps"


def get(key: str) -> Protocol:
    return PROTOCOLS.get(key or DEFAULT_KEY, PROTOCOLS[DEFAULT_KEY])


def choices() -> List[Tuple[str, str]]:
    """(key, display name) in the order they should appear in a picker."""
    order = ("reps", "rest", "distractor_daily", "distractor_extreme",
            "distractor", "ramp", "sustained")
    return [(k, PROTOCOLS[k].name) for k in order if k in PROTOCOLS]


def name_to_key(display: str) -> str:
    for key, name in choices():
        if name == display:
            return key
    return DEFAULT_KEY


def go_windows(phases: List[Phase]) -> List[Tuple[float, float]]:
    """The cued attempt windows — ground truth for the analysis.

    Returns GO phases for trigger probes AND MOVE phases for cued
    distractor probes. Both are cued activity intervals that
    downstream grouped-LORO CV keys on. PREPARE and RELAX phases
    are not attempts and are excluded.
    """
    return [(round(p.start_s, 3), round(p.end_s, 3))
            for p in phases if p.kind in (GO, MOVE)]


def phase_events(phases: List[Phase]) -> List[Dict[str, Any]]:
    """Full timeline as event dicts for CSV/JSON headers.

    Every phase becomes an event with (start_s, end_s, kind, label).
    Downstream analysis reads this to know EXACTLY what was displayed
    when, so a phase-vs-sample mismatch check can run at probe close.
    """
    return [{"start_s": round(p.start_s, 3),
             "end_s":   round(p.end_s, 3),
             "kind":    p.kind,
             "label":   p.label} for p in phases]


def phase_at(phases: List[Phase], t: float) -> Optional[Phase]:
    for phase in phases:
        if phase.contains(t):
            return phase
    return phases[-1] if phases and t >= phases[-1].end_s else None


def next_phase(phases: List[Phase], t: float) -> Optional[Phase]:
    for phase in phases:
        if phase.start_s > t:
            return phase
    return None


def summarise(key: str, **params: Any) -> str:
    """One line describing what is about to happen, for the UI."""
    proto = get(key)
    phases = proto.phases(**params)
    gos = go_windows(phases)
    total = phases[-1].end_s if phases else 0
    if not gos:
        return f"{total:.0f}s — {proto.description}"
    return (f"{total:.0f}s — {len(gos)} cued attempt"
            f"{'s' if len(gos) != 1 else ''} of "
            f"{gos[0][1] - gos[0][0]:.0f}s each")


if __name__ == "__main__":
    for key, name in choices():
        proto = get(key)
        phases = proto.phases(movement="clench")
        print(f"\n=== {key}: {name}  ({proto.probe_kind}) ===")
        print(f"    {summarise(key, movement='clench')}")
        for p in phases:
            print(f"    {p.start_s:5.1f}-{p.end_s:5.1f}s  {p.kind:8} {p.label}")
        print(f"    go windows: {go_windows(phases)}")
