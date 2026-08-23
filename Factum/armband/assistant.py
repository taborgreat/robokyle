"""Optional AI session assistant. The app works fully without it.

Everything else in Factum is local and offline: sessions happen in a
rehab facility on battery power, and the coach in `coach.py` gives
rule-based guidance with no network at all. This module is the second
opinion on top of that — never a prerequisite for it.

Two hard rules
--------------
1. **Never send raw sample arrays.** The classifier runs locally; the
   API sees compact summaries only. `build_payload()` assembles them
   and `_assert_no_bulk_data()` refuses to send anything that looks
   like a signal dump — a belt-and-braces check, because "we'd never
   do that" is how medical data leaks.
2. **Absence of a key is a normal state, not an error.** No key, no
   network, no `anthropic` package — each returns a clear explanation
   and the app carries on.

What it is good for: reading the numbers back in plain language,
ranking what to try next, flagging probe pairs that will get confused,
and saying which probes to promote or drop. What it must not be asked
for: the classification itself.

API notes (checked 2026-08-09)
------------------------------
* Model default `claude-opus-5`. NEXT.md named `claude-sonnet-4-6`
  when the roadmap was written; the default here is current, and
  `config.json` overrides it.
* `temperature` / `top_p` / `budget_tokens` are rejected on this model
  family — steer with the prompt instead.
* Thinking is on by default; depth is controlled with
  `output_config.effort`.
* Safety classifiers can decline a request: HTTP 200 with
  `stop_reason: "refusal"`. **Check that before reading `content`** —
  indexing `content[0]` unconditionally crashes on a refusal. Server-
  side fallbacks are opted into so a decline is re-run automatically.
"""

from __future__ import annotations

import json
import os
from typing import Any, Dict, List, Optional, Tuple

MODEL = "claude-opus-5"
MAX_TOKENS = 8000
EFFORT = "medium"

# Any list longer than this in the payload is treated as bulk signal
# data and blocks the send outright.
MAX_LIST_LEN = 64

_PROJECT_CONTEXT = """\
# What you are looking at

Factum is a Windows app that discovers which forearm signals a person \
can produce reliably enough to control a computer, and then turns the \
best of them into an actual input.

## Who this is for

Kyle, a bilateral upper-limb amputee. **The two sides are not alike, \
and this matters more than anything else in the project:**

- **LEFT — amputated about an inch above the wrist bone**, so the wrist \
bone itself is gone. A long transradial residual limb: nearly the whole \
forearm remains, and with it the finger and wrist muscle bellies. This \
is the arm the project is built around, and the only one a forearm band \
fits.
- **RIGHT — amputated at the elbow.** There is no forearm at all. A \
forearm band has nowhere to sit. Only upper-arm muscle remains (biceps, \
triceps), which carries no finger content whatsoever — it can serve as \
a coarse extra switch, never as a second hand.

Do NOT assume the right arm can produce anything resembling the left. \
If asked about using both arms, say plainly that there is one forearm \
here.

Every movement recorded is an ATTEMPTED or PHANTOM movement, not an \
executed one: there is no hand to move, and the signal comes from the \
residual limb. A helper puts the band on him, so repeatable electrode \
placement is a first-class concern, not a detail — the same movement \
recorded 2 cm further up the arm looks like a different movement. \
Placement is recorded as numbers (millimetres from the elbow crease, \
degrees of rotation) against a drawn limb, and appears in each probe's \
`placement` field.

He cannot reliably operate a mouse or keyboard, which is the whole \
reason the project exists. His own priority is using his iPhone; the PC \
is the development platform.

The Mudra Band's stock gestures (tap, pinch, swipe, point, rotate) are \
all defined by fingers touching, and its pressure feature measures \
literal thumb-to-finger contact. **None of that is anatomically \
available to him.** That is why the app trains on his own raw signals \
instead, and why **there is no fixed movement list anywhere in the \
project** — probe names are his own words ("the twitchy one" is a valid \
probe name).

## The hardware

A Mudra Band with three surface electrodes: ch1 ulnar, ch2 median, \
ch3 radial. Raw SNC (surface nerve conduction) values in the range \
-1..+1. Sample rate is measured per session, not assumed — it has been \
seen at ~1000 Hz via Mudra Companion and ~840 Hz via the Mudra Link \
Studio tab.

Two important hardware facts:

- The band must be in STANDBY. In ACTIVE mode it runs Mudra's own \
  gesture engine and consumes the signal locally, so nothing streams.
- Signals are grouped into mutually exclusive modes. `snc` is described \
  as standalone; IMU/pointer/navigation are separate modes. Whether \
  cursor movement (IMU pointer mode) can run at the same time as `snc` \
  is UNTESTED and is currently an open question in the project.

## How a session works

1. A **rest** recording first. Baseline drifts with placement, skin and \
   fatigue, so everything in a session is measured against that \
   session's own rest — never another day's.
2. **Probes**: short recordings of one attempted movement, default 30s. \
   The app cues each attempt visually (GO / RELAX with a countdown) and \
   **records the cue schedule alongside the samples**, so the analysis \
   knows when each attempt was supposed to happen instead of inferring \
   it. That is why you may see both "cued attempts" and "attempts that \
   produced signal" — the gap between them is a finding about him, not \
   about the software.
3. **Ratings** he and the helper give: effort, fatigue, and his own \
   confidence (1-5) that he did the same thing each time.
4. On session close the app automatically computes metrics, pairwise \
   separability, cross-session drift, and writes REPORT.md.

## Recording protocols available in the app

- **Repeated attempts** (default) — 5 cued attempts with stillness \
  between. The stillness is what separates one attempt from the next.
- **Rest / baseline** — stay still.
- **Everyday movement (NO attempt)** — ordinary arm motion (reaching, \
  rotating, scratching) with no trigger attempt. This is the NEGATIVE \
  class and the only way to measure false fires. Recommend it by name \
  when a session lacks one.
- **Graded effort** — gentle / medium / hard, to see dynamic range.
- **Sustained hold** — one long contraction; does it fade?

## What the app does with the data

- **Calibration** derives thresholds from that arm's own rest \
  recordings, per person, per session — nothing is a fixed constant. \
  The onset threshold is found by *search*: raise it until the resting \
  arm never trips it.
- **A classifier** (regularised LDA over 36 features: time-domain, \
  spectral shape, and cross-channel ratios) with classes for each \
  movement plus two REJECT classes — `rest` and `movement` (everyday \
  motion). Anything landing in a reject class produces no output.
- **Evaluation** is leave-one-repetition-out, so reported accuracy uses \
  held-out repetitions, never split windows from the same attempt.
- **A live detector** with three defences: a confidence threshold \
  chosen against a stated false-fire budget, a hold time (N consecutive \
  agreeing windows), and a refractory period.
- **Output** is pluggable (mouse click, keypress, later Bluetooth HID \
  to the iPhone) and defaults to dry run — it must be deliberately \
  armed.

## What "success" means

Work backwards from "Kyle drives a mouse". The tiers, in order:

1. **One reliable click.** With scanning (iOS Switch Control, Windows \
   Switch Access) a single dependable input drives an entire interface. \
   This is the only tier that must be reached.
2. **Two inputs** — select and back.
3. **Three or more** — diminishing returns, and each new input must \
   stay separable from every existing one.

An input only counts when it clears the trigger bar against everyday \
movement AND repeats on a different day with the band re-placed. A \
signal that worked once is not an input.

## How to weigh things

- **Consistency matters most.** A weak movement performed identically \
  every time beats a strong one that varies.
- **Effort and fatigue are tie-breakers, not disqualifiers.** A good, \
  repeatable result is worth keeping even if it is tiring. Do NOT \
  advise dropping a movement merely because it is strenuous — that \
  instruction was given explicitly.
- **Separation from ordinary arm movement decides everything.** A \
  movement that cannot be told apart from everyday motion will fire by \
  accident, and a phantom click while he is scratching his arm is the \
  failure that makes him stop trusting the system. A missed click is a \
  minor annoyance by comparison. Weight false positives far above \
  missed detections.
- **Amplitude alone is known not to work.** In real recordings, \
  ordinary arm movement reached the same level above rest as a genuine \
  attempt (+13.5 dB both) and defeated every amplitude threshold \
  tested. What separates them is the pattern — spectral shape and how \
  energy is distributed across the three electrodes.
- **Anatomy matters when suggesting movements.** Two movements driven \
  by the same muscle look alike however different they feel. Suggest \
  different muscle groups (flexors vs extensors vs supinator vs \
  interossei vs thenar), not "the same but harder".
"""

_DATA_NOTE = """\
## What you are given, and what you are not

You receive SUMMARIES ONLY: computed metrics, his ratings, the notes \
taken at the time, the calibration, and the automatic analysis. You \
will NOT receive raw sample arrays — the classifier runs locally and \
the recordings never leave that machine. Do not ask for them. If you \
need something specific, name the probe and the number you want.

Fields may be null. A null means "not measured" — say so rather than \
guessing around it.

## How to answer

You are a second opinion on top of the app's own local analysis, not a \
replacement for it. The app already computes the metrics and already \
gives rule-based guidance offline; your value is judgement across the \
whole picture, and noticing what the rules miss.

- Be concrete and brief. Lead with the answer.
- Rank suggestions, most valuable first, and say what you would do \
  NEXT SESSION specifically — naming a protocol and a movement, not \
  "collect more data".
- Say plainly when the data does not support a conclusion. One \
  session of one movement is not evidence of anything.
- The person reading this is running a session in a rehab room, on \
  battery, with someone who tires. Do not write a research paper.
"""


def build_system_prompt() -> str:
    """Assemble the prompt from the app's own constants.

    Metric definitions, the scoring formula and the capability tiers are
    pulled from the modules that implement them, so the assistant's
    understanding cannot drift from the code the way a hand-copied
    prompt would.
    """
    parts = [_PROJECT_CONTEXT]

    try:
        from analysis import METRIC_GLOSSARY, SCORING_EXPLANATION
        parts.append("## What the metrics mean\n\n" + "\n".join(
            f"- **{name}** — {meaning}" for name, meaning in METRIC_GLOSSARY))
        parts.append("Scoring: " + SCORING_EXPLANATION)
    except Exception:
        pass

    try:
        import vocabulary
        parts.append("## The open question about cursor movement\n\n"
                     + vocabulary.CURSOR_NOTE)
    except Exception:
        pass

    try:
        import probe_quality
        parts.append("## Judging whether a recording was any good\n\n"
                     + probe_quality.ASSISTANT_NOTE)
    except Exception:
        pass

    parts.append(_DATA_NOTE)
    return "\n\n".join(parts)


# Built once at import; the modules it reads from are static at runtime.
SYSTEM_PROMPT = build_system_prompt()


# =============================================================== backends
#
# Two ways to reach a model, and the preferred one costs nothing extra:
#
#   claude_cli — shells out to the Claude Code CLI already installed on
#                this machine. It runs on the operator's existing Claude
#                subscription, so there is no API key and no separate
#                bill. This is the default when available.
#   api        — the Anthropic SDK, billed as API usage.
#
# The distinction is a product boundary, not a technical one: the
# Messages API is billed separately from a Claude subscription, and no
# amount of code makes a subscription pay for API calls. Going through
# Claude Code sidesteps the question entirely by using the surface the
# subscription already covers.

CLI_TIMEOUT_S = 300
_CLI_CANDIDATES = (
    os.path.join(os.environ.get("APPDATA", ""), "npm", "claude.cmd"),
    os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs", "claude",
                 "claude.exe"),
    os.path.join(os.environ.get("USERPROFILE", ""), ".local", "bin", "claude.exe"),
)


def claude_cli_path() -> Optional[str]:
    """Locate the Claude Code CLI, without depending on PATH."""
    import shutil

    for name in ("claude.cmd", "claude.exe", "claude"):
        found = shutil.which(name)
        if found:
            return found
    for candidate in _CLI_CANDIDATES:
        if candidate and os.path.exists(candidate):
            return candidate
    return None


def backends() -> Dict[str, Any]:
    """What is available to talk to, and which will be used."""
    cli = claude_cli_path()
    try:
        import anthropic  # noqa: F401
        package = True
    except ImportError:
        package = False
    has_key = bool(os.environ.get("ANTHROPIC_API_KEY")
                   or os.environ.get("ANTHROPIC_AUTH_TOKEN"))

    preferred = None
    if cli:
        preferred = "claude_cli"
    elif package:
        preferred = "api"
    return {"claude_cli": cli, "api_package": package, "api_key": has_key,
            "preferred": preferred}


def status() -> Dict[str, Any]:
    """Can the assistant run right now, and if not, why not?"""
    state = backends()

    if state["preferred"] == "claude_cli":
        return {"available": True, "reason": "claude_cli",
                "backend": "claude_cli",
                "message": "Using Claude Code on this machine — runs on your "
                           "existing Claude subscription, no API key needed."}

    if state["preferred"] == "api":
        if not state["api_key"]:
            return {"available": True, "reason": "api_no_env_key",
                    "backend": "api",
                    "message": "Using the Anthropic API. No key in the "
                               "environment — a signed-in profile will be "
                               "used if you have one. Note API usage is "
                               "billed separately from a Claude subscription."}
        return {"available": True, "reason": "api", "backend": "api",
                "message": "Using the Anthropic API with a configured key."}

    return {
        "available": False,
        "reason": "no_backend",
        "backend": None,
        "message": "No way to reach a model yet. Easiest option: install "
                   "Claude Code (it runs on your Claude subscription and "
                   "needs no API key). Alternatively install the `anthropic` "
                   "package and add an API key.",
    }


def _ask_claude_cli(prompt: str, executable: str) -> Dict[str, Any]:
    """Run the prompt through Claude Code in non-interactive print mode.

    The prompt goes in on **stdin**, not as an argument: it runs to
    ~17 KB with a full session attached, and Windows caps a command
    line at about 8 KB.
    """
    import subprocess

    try:
        result = subprocess.run(
            [executable, "-p"], input=prompt, capture_output=True, text=True,
            timeout=CLI_TIMEOUT_S, encoding="utf-8", errors="replace",
            creationflags=0x08000000 if os.name == "nt" else 0)
    except FileNotFoundError:
        return {"ok": False, "reason": "cli_missing",
                "message": "Claude Code could not be started."}
    except subprocess.TimeoutExpired:
        return {"ok": False, "reason": "timeout",
                "message": f"Claude Code did not answer within "
                           f"{CLI_TIMEOUT_S}s."}
    except Exception as exc:
        return {"ok": False, "reason": "failed", "message": str(exc)[:300]}

    text = (result.stdout or "").strip()
    if result.returncode != 0 or not text:
        detail = (result.stderr or result.stdout or "").strip()[:500]
        lowered = detail.lower()
        if "login" in lowered or "auth" in lowered:
            return {"ok": False, "reason": "cli_auth",
                    "message": "Claude Code is not signed in. Run `claude` in "
                               "a terminal once and complete the login, then "
                               "try again.\n\n" + detail}
        return {"ok": False, "reason": "cli_error",
                "message": f"Claude Code exited with {result.returncode}."
                           + (f"\n\n{detail}" if detail else "")}
    return {"ok": True, "text": text, "model": "claude-code"}


# ================================================================ payload


def _round(value: Any, places: int = 3) -> Any:
    if isinstance(value, float):
        return round(value, places)
    if isinstance(value, list):
        return [_round(v, places) for v in value]
    return value


def build_payload(session, calibration: Optional[Dict[str, Any]] = None,
                  history: Optional[List[Any]] = None) -> Dict[str, Any]:
    """Compact, human-scale summary of a session. No sample data.

    Deliberately assembled field by field rather than by filtering a
    larger structure — an allow-list cannot leak something new that a
    future analysis field happens to add.
    """
    info = session.info()
    probes: List[Dict[str, Any]] = []
    for entry in session.probes():
        metrics = entry.get("metrics") or {}
        # The automatic verdict on the recording itself. Sent because an
        # opinion about a movement is worthless without knowing whether
        # the recording of it was sound — and because the assistant is
        # better than the rule set at deciding when a flag matters.
        quality = entry.get("quality") or metrics.get("quality") or {}
        probes.append({
            "probe":          entry.get("probe"),
            "kind":           entry.get("kind"),
            "duration_s":     entry.get("duration_s"),
            "effort":         entry.get("effort"),
            "fatigue":        entry.get("fatigue"),
            "his_confidence": entry.get("his_confidence"),
            "notes":          entry.get("notes"),
            "placement":      entry.get("placement"),
            "metrics": {
                "n_reps":            metrics.get("n_reps"),
                "n_reps_cued":       metrics.get("n_reps_cued"),
                "n_reps_with_signal": metrics.get("n_reps_with_signal"),
                "consistency":       _round(metrics.get("consistency")),
                "best_channel":      metrics.get("best_channel"),
                "best_channel_db":   _round(metrics.get("best_channel_db"), 1),
                "channel_signature": _round(metrics.get("channel_signature")),
                "onset_latency_s":   metrics.get("onset_latency_s"),
                "rise_time_s":       metrics.get("rise_time_s"),
                "usability":         _round(metrics.get("usability")),
            },
            "recording_quality": {
                "verdict":  quality.get("verdict"),
                "score":    quality.get("score"),
                "headline": quality.get("headline"),
                "flags":    [f.get("message") for f in
                             (quality.get("flags") or [])],
            } if quality else None,
        })

    analysis: Dict[str, Any] = {}
    if os.path.exists(session.analysis_json):
        try:
            with open(session.analysis_json, "r", encoding="utf-8") as f:
                raw = json.load(f)
            analysis = {
                "ranking": raw.get("ranking"),
                "separability": [
                    {k: p.get(k) for k in
                     ("a", "b", "d_prime", "expected_error", "distinct")}
                    for p in (raw.get("separability") or [])
                ],
                "repeatability": raw.get("repeatability"),
                "recommendations": raw.get("recommendations"),
                "rest": {k: _round(v) for k, v in (raw.get("rest") or {}).items()
                         if k in ("available", "duration_s", "rms",
                                  "dc_offset", "clip_fraction")},
            }
        except Exception:
            analysis = {}

    payload: Dict[str, Any] = {
        "profile":  session.profile,
        "arm":      session.arm,
        "session":  session.stamp,
        "context": {
            "date":        info.get("date"),
            "location":    info.get("location"),
            "present":     info.get("present"),
            "battery_pct": info.get("battery_pct"),
            "on_charger":  info.get("on_charger"),
            "notes":       info.get("notes"),
        },
        "session_notes": session.read_notes()[-4000:],
        "probes":   probes,
        "analysis": analysis,
    }

    if calibration:
        payload["calibration"] = {
            "noise_floor":       calibration.get("noise_floor"),
            "onset":             calibration.get("onset"),
            "separable_d_prime": calibration.get("separable_d_prime"),
            "d_prime_floor":     calibration.get("d_prime_floor"),
            "trigger":           calibration.get("trigger"),
        }

    if history:
        payload["earlier_sessions"] = [
            {"session": s.stamp,
             "probes": [{"probe": e.get("probe"),
                         "consistency": ((e.get("metrics") or {})
                                         .get("consistency")),
                         "usability": ((e.get("metrics") or {})
                                       .get("usability"))}
                        for e in s.probes()
                        if e.get("kind") not in ("rest", "baseline")]}
            for s in history[-4:]
        ]
    return payload


def _assert_no_bulk_data(payload: Any, path: str = "payload") -> None:
    """Refuse to send anything that looks like a signal dump.

    The allow-list in build_payload should make this unreachable. It
    exists because the cost of being wrong is sending a person's raw
    physiological recording to a third party, and a guard that never
    fires is cheap insurance against a future edit that forgets.
    """
    if isinstance(payload, dict):
        for key, value in payload.items():
            _assert_no_bulk_data(value, f"{path}.{key}")
    elif isinstance(payload, list):
        if len(payload) > MAX_LIST_LEN:
            raise ValueError(
                f"refusing to send {path}: {len(payload)} items looks like "
                f"raw sample data. Only summaries may leave this machine.")
        for i, item in enumerate(payload[:MAX_LIST_LEN]):
            _assert_no_bulk_data(item, f"{path}[{i}]")


def payload_size(payload: Dict[str, Any]) -> int:
    return len(json.dumps(payload, default=str))


# ================================================================== asking

DEFAULT_QUESTION = """\
Read this session and tell me:

1. What do these numbers actually mean, in plain language?
2. Which probes should be promoted into a training set, and which \
should be dropped — and why?
3. Which pairs will get confused by a classifier?
4. What specifically should we try in the next session, ranked, most \
valuable first?
5. Is anything in the placement, the baseline, or the ratings a warning \
sign I have missed?\
"""

NO_DATA_QUESTION = """\
Nothing has been recorded for this profile and arm yet.

Given what this app is for and who it is for, what would you do in the \
first session? Be specific: which movements are worth attempting first \
and why, where to place the band, what to record in what order, and \
what would tell me early that a movement is not going to work.\
"""


def ask(session=None, question: str = "",
        calibration: Optional[Dict[str, Any]] = None,
        history: Optional[List[Any]] = None,
        model: str = "", save: bool = True) -> Dict[str, Any]:
    """Ask a question, with or without a session attached.

    `session` is optional on purpose. Before any data exists there are
    still real questions worth asking — what to try first, how to place
    the band, whether a movement idea is worth attempting — and an
    assistant that refuses to speak until you have recorded something
    is useless exactly when the guidance is most valuable.

    Never raises for the ordinary failure modes — no backend, no
    network, a refusal — because those are states the UI has to display
    calmly, not stack traces.
    """
    state = status()
    if not state["available"]:
        return {"ok": False, "reason": state["reason"],
                "message": state["message"]}

    payload: Optional[Dict[str, Any]] = None
    if session is not None:
        try:
            payload = build_payload(session, calibration, history)
            _assert_no_bulk_data(payload)
        except ValueError as exc:
            return {"ok": False, "reason": "payload_blocked",
                    "message": str(exc)}
        except Exception as exc:
            return {"ok": False, "reason": "payload_failed",
                    "message": f"Could not assemble the summary: {exc}"}

    if payload is not None:
        body = (question.strip() or DEFAULT_QUESTION) + \
            "\n\nSession data:\n\n```json\n" + \
            json.dumps(payload, indent=2, default=str) + "\n```"
    else:
        body = (question.strip() or NO_DATA_QUESTION) + \
            "\n\n(No session data is attached — nothing has been recorded " \
            "for this profile and arm yet. Answer from the project context " \
            "above, and say what would need to be recorded to answer " \
            "properly if the question needs data.)"

    # --- Claude Code path: the operator's own subscription, no API key.
    if state.get("backend") == "claude_cli":
        executable = claude_cli_path()
        # Claude Code takes one prompt, so the system context is folded
        # in rather than passed separately.
        result = _ask_claude_cli(
            SYSTEM_PROMPT + "\n\n---\n\n" + body, executable)
        if not result.get("ok"):
            return result
        out = {"ok": True, "text": result["text"], "model": "Claude Code",
               "backend": "claude_cli",
               "payload_bytes": payload_size(payload) if payload else 0,
               "usage": {}}
        if save and session is not None:
            out["saved_to"] = save_notes(session, question or DEFAULT_QUESTION,
                                         result["text"])
        return out

    # --- API path.
    import anthropic

    prompt = body

    try:
        client = anthropic.Anthropic()
        # Streaming because a long answer on a slow connection would
        # otherwise risk an HTTP timeout; the helper hands back the
        # complete message so there are no stream events to handle.
        with client.beta.messages.stream(
            model=model or MODEL,
            max_tokens=MAX_TOKENS,
            system=SYSTEM_PROMPT,
            output_config={"effort": EFFORT},
            # Safety classifiers can decline; a fallback re-runs the
            # request server-side rather than handing back a refusal.
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            messages=[{"role": "user", "content": prompt}],
        ) as stream:
            response = stream.get_final_message()
    except anthropic.AuthenticationError:
        return {"ok": False, "reason": "auth",
                "message": "The API key was rejected. Check ANTHROPIC_API_KEY, "
                           "or run `ant auth login`."}
    except anthropic.RateLimitError:
        return {"ok": False, "reason": "rate_limit",
                "message": "Rate limited. Wait a moment and try again — "
                           "nothing was lost."}
    except anthropic.APIConnectionError:
        return {"ok": False, "reason": "offline",
                "message": "Could not reach the API. The assistant is the only "
                           "part of Factum that needs internet; everything "
                           "else still works."}
    except anthropic.APIStatusError as exc:
        return {"ok": False, "reason": "api_error",
                "message": f"API error {exc.status_code}: {exc.message}"}
    except Exception as exc:
        return {"ok": False, "reason": "failed", "message": str(exc)}

    # Check the stop reason BEFORE reading content — a refusal can carry
    # an empty content list, and indexing it would crash.
    if response.stop_reason == "refusal":
        detail = getattr(response, "stop_details", None)
        category = getattr(detail, "category", None) if detail else None
        return {"ok": False, "reason": "refusal",
                "message": "The request was declined by a safety classifier"
                           + (f" ({category})" if category else "")
                           + ". This is unusual for session data — try asking "
                             "a narrower question."}

    text = "\n".join(b.text for b in response.content
                     if getattr(b, "type", None) == "text").strip()
    if not text:
        return {"ok": False, "reason": "empty",
                "message": f"No text came back (stop reason: "
                           f"{response.stop_reason})."}

    result = {
        "ok": True,
        "text": text,
        "model": response.model,
        "backend": "api",
        "payload_bytes": payload_size(payload) if payload else 0,
        "usage": {
            "input_tokens": getattr(response.usage, "input_tokens", None),
            "output_tokens": getattr(response.usage, "output_tokens", None),
        },
    }
    if save and session is not None:
        result["saved_to"] = save_notes(session, question or DEFAULT_QUESTION,
                                        text)
    return result


QUICK_OPINION_QUESTION = """\
A recording just finished. In AT MOST 3 short sentences, tell the person \
in the room:

1. whether that recording was any good,
2. anything wrong or suspicious about it,
3. what to do immediately next.

Be blunt and specific. If it was fine, say so in one line and move on — \
do not pad. If something looks wrong (band slipped, he did not actually \
produce the movement, the baseline is noisy, it duplicates something \
already recorded), say that plainly, because they can fix it while he \
is still sitting there. No preamble, no headings, no bullet list.\
"""


def quick_opinion(session, calibration: Optional[Dict[str, Any]] = None,
                  history: Optional[List[Any]] = None) -> Dict[str, Any]:
    """A short verdict on the recording that just finished.

    Deliberately tiny: three sentences, asked automatically, answered
    while the person is still in the chair. The value of a comment on a
    recording decays fast — "the band looks like it slipped" is worth a
    lot in the ten seconds before the next probe and nothing at all in
    the report on the drive home.

    Kept separate from `ask()` so the automatic path can never be
    mistaken for the considered one, and so it stays cheap enough to
    run after every single recording.
    """
    return ask(session, QUICK_OPINION_QUESTION, calibration=calibration,
               history=history, save=False)


def save_notes(session, question: str, answer: str) -> str:
    """Append the exchange to the session folder — it is part of the record."""
    import datetime as dt

    path = os.path.join(session.root, "ASSISTANT_NOTES.md")
    stamp = dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    header = "" if os.path.exists(path) else (
        f"# Assistant notes — {session.profile} / {session.arm} / "
        f"{session.stamp}\n\n"
        f"Answers from the optional AI assistant. Summaries only were sent — "
        f"never raw recordings. Treat these as a second opinion on the "
        f"numbers in REPORT.md, not as a substitute for them.\n\n")
    with open(path, "a", encoding="utf-8") as f:
        f.write(header)
        f.write(f"## {stamp}\n\n**Asked:** {question.strip()}\n\n{answer}\n\n---\n\n")
    return path


# --------------------------------------------------------------- self-test

if __name__ == "__main__":
    import sys

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import calibrate
    from profiles import ProfileStore

    state = status()
    print(f"available : {state['available']}  ({state['reason']})")
    print(f"            {state['message']}")
    print()

    store = ProfileStore()
    for name in (sys.argv[1:2] or store.list_profiles()[:1]):
        profile = store.load(name)
        for arm in ("left", "right"):
            sessions = [s for s in profile.sessions(arm) if s.probes()]
            if not sessions:
                continue
            sess = sessions[-1]
            payload = build_payload(sess, calibrate.load(profile, arm),
                                    sessions[:-1])
            print(f"=== payload for {name}/{arm}/{sess.stamp} ===")
            print(f"  size        : {payload_size(payload):,} bytes")
            print(f"  probes      : {len(payload['probes'])}")
            print(f"  keys        : {sorted(payload.keys())}")
            try:
                _assert_no_bulk_data(payload)
                print("  bulk check  : PASS — no sample arrays present")
            except ValueError as exc:
                print(f"  bulk check  : BLOCKED — {exc}")

            # Prove the guard actually fires.
            poisoned = dict(payload)
            poisoned["raw"] = list(range(MAX_LIST_LEN + 1))
            try:
                _assert_no_bulk_data(poisoned)
                print("  guard test  : FAIL — bulk data was NOT caught")
                raise SystemExit(1)
            except ValueError:
                print("  guard test  : PASS — bulk data is refused")
            break
    print("\n(no request was sent; run from the app to actually ask)")
