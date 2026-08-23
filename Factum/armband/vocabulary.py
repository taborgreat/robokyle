"""Working backwards from "Kyle drives a mouse" to what to record next.

Every other module answers "what is this signal like?". This one asks
the question that actually matters: **how many usable inputs does he
need, how many does he have, and what should we record next to close
the gap?**

The distinction matters because more probes is not the goal. Two
reliable signals beat six unreliable ones, and a session spent adding a
seventh variant of a movement he already has is a session wasted. The
planner names the specific missing capability instead.

Tiers, in the order they unlock usefulness
------------------------------------------
Each tier is genuinely usable on its own — this is deliberately not an
all-or-nothing plan, because the difference between zero and one
reliable input is far larger than between two and three.

1. **One reliable click.** With scanning (iOS Switch Control, Windows
   Switch Access), a single input drives an entire interface: the
   cursor cycles, one signal selects. This is the whole system in
   miniature and the only tier that must be reached.
2. **Two inputs.** Select plus back/cancel. Removes the wait-for-the-
   scan-to-come-round tax that makes single-switch tiring.
3. **Three or more.** Right-click, scroll, modifier. Diminishing
   returns, and each new input must stay separable from *every*
   existing one — difficulty grows faster than the payoff.

Cursor movement is deliberately absent from the tiers: it is not an
SNC problem. See `CURSOR_NOTE`.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

# Recorded here because it is a real architectural question with a
# cheap answer that nobody has run yet, and building the wrong thing on
# a guess would be expensive.
CURSOR_NOTE = """\
THE CURSOR IS NOT THE PROBLEM. THE CLICK IS THE PROBLEM.

The Mudra Band already moves a cursor well, from its IMU pointer mode
(`navigation` + `button`) — arm pointing and wrist orientation, which
need no fingers and work for Kyle today. Mudra's own iPhone app proves
it: he gets a working cursor and nothing to select with.

What does NOT work for him is the click. Every Mudra gesture is defined
by finger-pad conductance or thumb-to-finger contact, and he has no
fingertips. He can point at things all day and never select one.

So Factum replaces exactly one thing: the click. Do not redesign the
cursor, and do not propose scanning or switch-based control as a
substitute — that was considered and rejected. A click with no cursor
is useless, and he already has a cursor.

THE BLOCKING QUESTION
---------------------
Can the band deliver raw SNC and IMU navigation AT THE SAME TIME?

  * STANDBY releases raw SNC to the WebSocket — what Factum needs.
  * ACTIVE runs Mudra's own engine locally, and SNC does not stream.
  * The docs group signals into mutually exclusive modes and call `snc`
    "standalone", which suggests not. THIS HAS NEVER BEEN TESTED.

If they CAN coexist: Mudra drives the cursor, Factum fires the click.
That is the intended design and it is clean.

If they CANNOT: Factum has to supply both. The IMU is in the band
regardless, so the question becomes whether the host exposes orientation
alongside SNC — if it does, Factum moves the cursor itself via
SendInput and becomes the whole input stack.

It is a five-minute check with the band on: subscribe to `snc` and
`navigation` together and see whether both deliver.

There is no fallback to "two bands, one per arm". Kyle's right limb is
amputated at the elbow — there is no second forearm. See anatomy.py.

Do not design the mouse layer until this is answered.\
"""


class Capability:
    """One input the system needs, and whether a probe satisfies it."""

    def __init__(self, key: str, name: str, tier: int, why: str,
                 examples: Tuple[str, ...] = ()) -> None:
        self.key = key
        self.name = name
        self.tier = tier
        self.why = why
        self.examples = examples


CAPABILITIES: List[Capability] = [
    Capability(
        "select", "A reliable select / click", 1,
        "With scanning, one dependable input drives an entire interface. "
        "Everything else is an optimisation on top of this.",
        ("curl index finger", "clench whole fist", "press thumb down"),
    ),
    Capability(
        "back", "A second, clearly different input", 2,
        "Back or cancel. Without it, every mistake costs a full scan "
        "cycle — which is what makes single-switch use tiring rather "
        "than merely slow.",
        ("bend wrist up", "spread fingers", "rotate palm up"),
    ),
    Capability(
        "third", "A third input", 3,
        "Right-click, scroll, or a modifier. Worth having, but only "
        "once the first two are solid on separate days.",
        ("curl little finger", "bend wrist down", "press thumb down"),
    ),
]

# A capability counts as met only when the movement clears the trigger
# bar against everyday movement AND repeats across days. Either alone
# is a signal that worked once, not an input someone can rely on.
REQUIRE_CROSS_SESSION = True


def _safe_candidates(calibration: Dict[str, Any]) -> List[Dict[str, Any]]:
    trigger = (calibration or {}).get("trigger", {}) or {}
    if not trigger.get("available"):
        return []
    return [c for c in trigger.get("candidates", []) if c.get("safe")]


def _cross_session_names(sessions: List[Any]) -> Dict[str, int]:
    """How many distinct sessions each probe name appears in."""
    counts: Dict[str, int] = {}
    for sess in sessions:
        seen = set()
        for entry in sess.active_probes():
            if entry.get("kind") in ("rest", "baseline", "distractor"):
                continue
            name = (entry.get("probe") or "").strip().lower()
            if name and name not in seen:
                seen.add(name)
                counts[name] = counts.get(name, 0) + 1
    return counts


def assess(profile, arm: str, calibration: Dict[str, Any]) -> Dict[str, Any]:
    """What he has, what is missing, and what to do about it."""
    sessions = [s for s in profile.sessions(arm) if s.active_probes()] if profile else []
    safe = _safe_candidates(calibration)
    appearances = _cross_session_names(sessions)

    # Rank confirmed inputs by how far they sit from everyday movement.
    confirmed: List[Dict[str, Any]] = []
    provisional: List[Dict[str, Any]] = []
    for candidate in sorted(safe, key=lambda c: -c.get("d_prime_vs_movement", 0)):
        name = (candidate.get("probe") or "").strip()
        days = appearances.get(name.lower(), 0)
        record = {
            "probe":    name,
            "d_prime":  candidate.get("d_prime_vs_movement"),
            "hold_s":   candidate.get("hold_time_s"),
            "false_fire": candidate.get("projected_false_fire"),
            "sessions": days,
        }
        if days >= 2 or not REQUIRE_CROSS_SESSION:
            confirmed.append(record)
        else:
            provisional.append(record)

    assigned: Dict[str, Dict[str, Any]] = {}
    pool = list(confirmed)
    for capability in CAPABILITIES:
        if pool:
            assigned[capability.key] = pool.pop(0)

    met = len(assigned)
    tier = 0
    for capability in CAPABILITIES:
        if capability.key in assigned:
            tier = max(tier, capability.tier)

    missing = [c for c in CAPABILITIES if c.key not in assigned]
    return {
        "arm":          arm,
        "tier":         tier,
        "tier_name":    _tier_name(tier),
        "confirmed":    confirmed,
        "provisional":  provisional,
        "assigned":     assigned,
        "missing":      [{"key": c.key, "name": c.name, "tier": c.tier,
                          "why": c.why, "examples": list(c.examples)}
                         for c in missing],
        "capabilities_met": met,
        "capabilities_total": len(CAPABILITIES),
        "next_action":  _next_action(confirmed, provisional, missing, sessions),
        "cursor_note":  CURSOR_NOTE,
        "spare_inputs": pool,
    }


def _tier_name(tier: int) -> str:
    return {
        0: "No usable input yet",
        1: "One reliable input — scanning control is possible",
        2: "Two inputs — select and back",
        3: "Three or more inputs",
    }.get(tier, f"tier {tier}")


def _next_action(confirmed: List[Dict[str, Any]],
                 provisional: List[Dict[str, Any]],
                 missing: List[Capability],
                 sessions: List[Any]) -> Dict[str, str]:
    """One instruction, chosen by what would move the needle most."""
    if not sessions:
        return {"headline": "Record a first session.",
                "detail": "Rest, a movement, and an everyday-movement "
                          "sample — that is the minimum from which "
                          "anything can be concluded."}

    # Confirming a provisional input beats hunting for a new one: a
    # signal that worked once is not yet an input, and a second day of
    # data on it is cheaper than a first day on something else.
    if provisional and len(confirmed) < 1:
        best = provisional[0]
        return {
            "headline": f"Record '{best['probe']}' again on another day.",
            "detail": f"It already separates from ordinary movement "
                      f"(d'={best['d_prime']}), but only in one session. "
                      f"Re-place the band and record it again — repeating "
                      f"across days with a fresh placement is what turns a "
                      f"promising signal into an input you can rely on.",
        }

    if missing:
        capability = missing[0]
        if capability.tier == 1:
            return {
                "headline": "Keep looking for one movement that beats "
                            "everyday arm movement.",
                "detail": f"{capability.why} Nothing recorded so far clears "
                          f"that bar. Try something anatomically distinct "
                          f"rather than stronger — e.g. "
                          f"{', '.join(capability.examples[:2])}. Record an "
                          f"everyday-movement sample in the same session, "
                          f"or the comparison cannot be made.",
            }
        return {
            "headline": f"Look for {capability.name.lower()}.",
            "detail": f"{capability.why} It has to be separable from "
                      f"everyday movement AND from the input you already "
                      f"have, so pick a different muscle group — e.g. "
                      f"{', '.join(capability.examples[:2])}.",
        }

    return {
        "headline": "You have the inputs you need — start using them.",
        "detail": "Further movements add difficulty faster than value. "
                  "Bind the best one to a click, run it dry for a session, "
                  "and only add a third input if daily use shows a real "
                  "need for it.",
    }


def summary_lines(assessment: Dict[str, Any]) -> List[str]:
    """Human-readable rendering for the UI and the report."""
    L: List[str] = []
    L.append(f"{assessment['tier_name']}  "
             f"({assessment['capabilities_met']} of "
             f"{assessment['capabilities_total']} capabilities)")
    L.append("")

    if assessment["assigned"]:
        L.append("Inputs you have:")
        for capability in CAPABILITIES:
            record = assessment["assigned"].get(capability.key)
            if not record:
                continue
            L.append(f"  [x] {capability.name}: '{record['probe']}' — "
                     f"d'={record['d_prime']} vs everyday movement, hold "
                     f"{record['hold_s']}s, ~{record['false_fire']*100:.3f}% "
                     f"false fires, confirmed across {record['sessions']} "
                     f"sessions")
    if assessment["provisional"]:
        L.append("")
        L.append("Promising but unconfirmed (one session only):")
        for record in assessment["provisional"]:
            L.append(f"  [~] '{record['probe']}' — d'={record['d_prime']}. "
                     f"Record it again on another day.")
    if assessment["missing"]:
        L.append("")
        L.append("Still missing:")
        for capability in assessment["missing"]:
            L.append(f"  [ ] {capability['name']} — {capability['why']}")

    action = assessment["next_action"]
    L.append("")
    L.append(f"NEXT: {action['headline']}")
    L.append(f"      {action['detail']}")
    return L


# --------------------------------------------------------------- self-test

if __name__ == "__main__":
    import os
    import sys

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import calibrate
    from profiles import ProfileStore

    store = ProfileStore()
    for name in (sys.argv[1:] or store.list_profiles()):
        try:
            profile = store.load(name)
        except Exception:
            continue
        for arm in ("left", "right"):
            if not [s for s in profile.sessions(arm) if s.active_probes()]:
                continue
            assessment = assess(profile, arm, calibrate.load(profile, arm))
            print(f"\n=== {name} / {arm} ===")
            for line in summary_lines(assessment):
                print("  " + line)

    print("\n" + "=" * 68)
    print("OPEN QUESTION — cursor movement")
    print("=" * 68)
    print(CURSOR_NOTE)
