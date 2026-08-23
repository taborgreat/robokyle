"""Factum — main tkinter app.

Design principle, and the one that overrides the rest: **more in the
background, less on screen.**

The person driving the main screen is a helper in a rehab room who has
never seen this app before — not the developer. So:

  * The default view shows only what is needed to run a session:
    profile, arm, signal status, and the current action. Nothing else.
  * Anything the app can decide for itself, it decides — thresholds,
    window sizes, session naming, filenames, when to analyse. A control
    exists only where someone genuinely needs to override the choice,
    and then it lives behind **Advanced**, which is off by default.
  * Session creation, rest prompting, continuous saving, analysis on
    close, file organisation and logging all happen silently. None of
    them needs a click.
  * Diagnostics live in the Log tab, never in the main flow.

Layout:
    HeaderBar     profile · arm · status · session timer · quick note
    Banner        one sentence, only when something needs doing
    Session tab   the Exploration Lab — name it, record, rate it, done
    Log tab       connection state, ranked causes, event log
    (Advanced)    Contact & Placement, Profile, and the tabs to come

Run:  python C:\\Users\\user\\mudra-project\\armband\\app.py
"""

from __future__ import annotations

import math
import os
import sys
import threading
import time
from pathlib import Path
import tkinter as tk
from tkinter import filedialog, messagebox, simpledialog, ttk
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

from config import CONFIG
from mudra_client import (
    MudraClient,
    STATE_ALREADY_IN_USE,
    STATE_CONNECTING,
    STATE_LIVE,
    STATE_NO_BAND,
    STATE_NO_SNC,
    STATE_NO_WS,
)
from contact_check import compute_metrics, evaluate, format_report
from profiles import (
    ARM_LEFT,
    ARM_RIGHT,
    ARMS,
    Profile,
    ProfileStore,
    TYPE_DEBUG,
    TYPE_SUBJECT,
    TYPES,
    validate_name,
)
import coach
import protocols
import quality
from probe_store import ProbeMeta, ProbeWriter, load_probe
from session import Session, is_rest_name

# ---------- theme -------------------------------------------------------

BG = "#000000"
CARD = "#181e21"
CARD_ALT = "#0f172a"
PRIMARY = "#77EAE9"
ACCENT = "#2dd4bf"
TEXT = "#f8fafc"
TEXT_DIM = "#94a3b8"
SUCCESS = "#22c55e"
WARN = "#eab308"
ERROR = "#ef4444"
DEBUG_BADGE = "#7c3aed"

STATE_COLORS = {
    STATE_LIVE: SUCCESS,
    STATE_NO_WS: ERROR,
    STATE_NO_BAND: WARN,
    STATE_CONNECTING: PRIMARY,
    STATE_NO_SNC: WARN,
    STATE_ALREADY_IN_USE: ERROR,
}

STATE_LABELS = {
    STATE_LIVE: "LIVE",
    STATE_NO_WS: "NO HOST",
    STATE_NO_BAND: "NO BAND",
    STATE_CONNECTING: "CONNECTING",
    STATE_NO_SNC: "NO SIGNAL",
    STATE_ALREADY_IN_USE: "IN USE ELSEWHERE",
}

EFFORTS = ("easy", "moderate", "strenuous")
FATIGUES = ("none", "some", "high")


def _fallback_fs() -> int:
    """Sample rate to assume when it could not be measured.

    Every probe measures and stamps its own rate, so this only fires
    when the stream stuttered at the instant recording began. It used
    to be 1000 — the documented figure — while the stream actually
    delivers 830-840 Hz. That is 19% high, and it would have been
    written permanently into a file whose whole point is to describe
    itself accurately in ten years' time.
    """
    return int(CONFIG.get("fallback_sample_rate_hz"))


def _fmt(v: Any, nd: int = 2) -> str:
    if v is None or v == "":
        return "—"
    try:
        return f"{float(v):.{nd}f}"
    except (TypeError, ValueError):
        return str(v)


def _fmt_db(v: Any) -> str:
    return "—" if v is None else f"{float(v):+.1f} dB"


def _reveal(path: str) -> None:
    """Open a folder or file in the OS file manager (Windows)."""
    if not path:
        return
    try:
        if os.path.isdir(path):
            os.startfile(path)                       # type: ignore[attr-defined]
        elif os.path.isfile(path):
            os.startfile(path)                       # type: ignore[attr-defined]
    except Exception:
        pass


def _button(master, text, command, *, bg=CARD_ALT, fg=TEXT, big=False, **kw):
    font = ("Segoe UI Semibold", 11) if big else ("Segoe UI", 9)
    pad = {"padx": 16, "pady": 8} if big else {"padx": 10, "pady": 4}
    pad.update({k: kw.pop(k) for k in ("padx", "pady") if k in kw})
    return tk.Button(master, text=text, command=command, bg=bg, fg=fg,
                     activebackground=PRIMARY if bg == ACCENT else CARD,
                     activeforeground="#000000" if bg == ACCENT else PRIMARY,
                     relief="flat", bd=0, font=font, **pad, **kw)


# --------------------------------------------------------------- naming
#
# Semantic widget naming for the bug-report widget picker. tkinter's
# default `str(widget)` gives paths like `.!frame.!notebook.!label3`
# which are useless in a report. Any widget that might get picked
# should be given a dotted-path name via `name_widget(w, "…")`. This
# is done incrementally as code is touched — no big renaming pass.
# Unnamed widgets still work; the picker falls back to their class +
# tkinter path.

def name_widget(widget, name: str):
    """Attach a semantic name so the bug-report picker can identify it."""
    try:
        setattr(widget, "_semantic_name", str(name))
    except Exception:
        pass
    return widget


def widget_name(widget) -> str:
    """Semantic name if one exists, else the tkinter path."""
    if widget is None:
        return "(none)"
    n = getattr(widget, "_semantic_name", None)
    if n:
        return n
    try:
        return str(widget)
    except Exception:
        return repr(widget)


# ============================================================== header bar


class HeaderBar(tk.Frame):
    """Everything the helper needs at a glance, and nothing else.

    Profile, arm, whether the signal is alive, how long we have been
    going, a place to drop a note, and the Advanced switch.
    """

    def __init__(self, master, app: "App") -> None:
        super().__init__(master, bg=CARD_ALT, padx=12, pady=8)
        self.app = app

        # -- profile
        tk.Label(self, text="Profile", bg=CARD_ALT, fg=TEXT_DIM,
                 font=("Segoe UI", 9)).pack(side="left")
        self.profile_var = tk.StringVar(value="")
        self.profile_menu = ttk.Combobox(self, textvariable=self.profile_var,
                                         width=18, state="readonly", values=())
        self.profile_menu.pack(side="left", padx=(6, 4))
        self.profile_menu.bind("<<ComboboxSelected>>", self._on_profile_pick)
        _button(self, "+ New", self._new_profile, bg=CARD, fg=PRIMARY,
                padx=8, pady=2).pack(side="left")

        self.type_badge = tk.Label(self, text="  ", bg=DEBUG_BADGE, fg="#ffffff",
                                   font=("Segoe UI Semibold", 8), padx=6, pady=2)
        self.type_badge.pack(side="left", padx=(8, 0))

        # -- repair / restart
        #
        # In the header rather than buried in a tab, because the moment
        # you need them is the moment the signal died and you are
        # standing over someone's arm. Repair fixes the common case
        # without losing the session; Restart is the sledgehammer that
        # used to mean killing the app from Task Manager.
        _button(self, "⟳ Repair", self._repair, bg=CARD, fg=WARN,
                padx=8, pady=2).pack(side="left", padx=(12, 0))
        _button(self, "Restart", self._restart_app, bg=CARD, fg=TEXT_DIM,
                padx=8, pady=2).pack(side="left", padx=(4, 0))

        # -- arm
        tk.Label(self, text="Arm", bg=CARD_ALT, fg=TEXT_DIM,
                 font=("Segoe UI", 9)).pack(side="left", padx=(16, 4))
        self.arm_var = tk.StringVar(value=ARM_RIGHT)
        arm_frame = tk.Frame(self, bg=CARD_ALT)
        arm_frame.pack(side="left")
        for arm in (ARM_LEFT, ARM_RIGHT):
            tk.Radiobutton(
                arm_frame, text=arm.capitalize(), variable=self.arm_var,
                value=arm, command=self._on_arm_pick,
                bg=CARD_ALT, fg=TEXT, selectcolor=CARD,
                activebackground=CARD_ALT, activeforeground=PRIMARY,
                relief="flat", bd=0, indicatoron=False, padx=10, pady=2,
                font=("Segoe UI Semibold", 9), highlightthickness=0,
            ).pack(side="left", padx=1)

        # -- signal chip
        self.chip = tk.Label(self, text=" … ", bg="#334155", fg="#000000",
                             font=("Segoe UI Semibold", 10), padx=10, pady=3)
        self.chip.pack(side="left", padx=(18, 8))

        # -- click-status chip. Reads TuningTab.detector + router each
        # tick so the operator can glance up from anywhere and know
        # Factum is what's firing. Grey = idle (no model / detector
        # not yet initialised), cyan = scanning (detector live but
        # not armed), green = armed (clicks will fire), amber flash
        # on every fire event. Click the chip to jump to Tuning.
        self.click_chip = tk.Label(
            self, text=" click: — ", bg="#334155", fg="#000000",
            font=("Segoe UI Semibold", 10), padx=10, pady=3, cursor="hand2")
        self.click_chip.pack(side="left", padx=(0, 8))
        self.click_chip.bind("<Button-1>", self._jump_to_tuning)
        # Progress-to-fire micro-bar, right of the chip.
        self.click_bar = tk.Canvas(self, width=80, height=8,
                                   bg=CARD_ALT, highlightthickness=0)
        self.click_bar.pack(side="left")
        self._click_last_fire_ts = 0.0
        self._click_fire_count = 0
        self._click_flash_until = 0.0

        # -- open Mudra Link. Pairing the band is the one thing Factum
        # cannot do for itself, so the way to it is one click, always
        # visible, and it highlights when there is no signal.
        self.link_btn = _button(self, "Open Mudra Link", self._open_link,
                                bg=CARD, fg=PRIMARY)
        self.link_btn.pack(side="left", padx=(4, 0))

        # -- session timer
        self.timer_var = tk.StringVar(value="")
        tk.Label(self, textvariable=self.timer_var, bg=CARD_ALT, fg=TEXT_DIM,
                 font=("Consolas", 11)).pack(side="left")

        # -- advanced toggle (right edge)
        self.advanced_var = tk.BooleanVar(value=bool(CONFIG.get("advanced")))
        self.adv_btn = _button(self, "", self._toggle_advanced, bg=CARD, fg=TEXT_DIM)
        self.adv_btn.pack(side="right")
        self._sync_advanced_label()

        # -- Report bug: always visible, one click, never interrupts.
        # Auto-captures context (tab, profile, arm, connection, logs).
        # Writes to reportedbugs/<stamp>_<page>.md — Claude reads that
        # folder at every session start per CLAUDE.md.
        _button(self, "Report bug", self._open_bug_report,
                bg=CARD, fg=ERROR).pack(side="right", padx=(0, 6))

        # -- quick note: always reachable, never interrupts a recording
        self.note_var = tk.StringVar(value="")
        note_entry = tk.Entry(self, textvariable=self.note_var, bg=CARD, fg=TEXT,
                              insertbackground=TEXT, relief="flat", width=26,
                              font=("Segoe UI", 10))
        note_entry.pack(side="right", padx=(0, 6))
        note_entry.bind("<Return>", lambda _e: self.add_quick_note())
        _button(self, "Note", self.add_quick_note, bg=CARD,
                fg=PRIMARY).pack(side="right", padx=(0, 4))

        self.after(300, self._tick)

    # ------------------------------------------------------------ refresh

    def refresh(self) -> None:
        names = self.app.store.list_profiles()
        self.profile_menu.configure(values=names)
        if self.app.profile:
            self.profile_var.set(self.app.profile.name)
            self.arm_var.set(self.app.profile.active_arm)
            if self.app.profile.type == TYPE_DEBUG:
                self.type_badge.configure(text=" DEBUG ", bg=DEBUG_BADGE, fg="#ffffff")
            else:
                self.type_badge.configure(text=" SUBJECT ", bg=ACCENT, fg="#000000")

    def _tick(self) -> None:
        state = self.app.client.signal_state()
        self.chip.configure(text=f" {STATE_LABELS.get(state, '…')} ",
                            bg=STATE_COLORS.get(state, "#334155"))
        self._update_click_status()

        # The Link button only shouts when it is the thing to do next:
        # no host at all, or a host with no band attached.
        if self.link_btn["state"] != "disabled":
            if state in (STATE_NO_WS, STATE_NO_BAND):
                self.link_btn.configure(bg=ACCENT, fg="#000000")
            else:
                self.link_btn.configure(bg=CARD, fg=PRIMARY)

        sess = self.app.open_session()
        if sess is None:
            self.timer_var.set("")
        else:
            elapsed = int(sess.elapsed_seconds())
            self.timer_var.set(f"{elapsed // 3600:d}:{elapsed % 3600 // 60:02d}:"
                               f"{elapsed % 60:02d}"
                               if elapsed >= 3600
                               else f"{elapsed // 60:02d}:{elapsed % 60:02d}")
        self.after(500, self._tick)

    def _sync_advanced_label(self) -> None:
        on = self.advanced_var.get()
        self.adv_btn.configure(text="Advanced ▾" if on else "Advanced ▸",
                               fg=PRIMARY if on else TEXT_DIM)

    # ----------------------------------------------------------- handlers

    def _open_bug_report(self) -> None:
        BugReportDialog(self.app)

    def _jump_to_tuning(self, _event=None) -> None:
        try:
            self.app.notebook.select(self.app.trigger_tab)
        except Exception:
            pass

    def _update_click_status(self) -> None:
        """Mirror the Trigger-tab router. DISPLAY ONLY.

        Strict rules — the chip is a passive readout of the router.
        It never shows "FIRED" unless the router ACTUALLY DELIVERED a
        click. Detector-internal decisions that the router blocked do
        NOT flash the chip.

          - grey  → no detector loaded yet
          - cyan  → detector scanning, router NOT armed
          - green → router ARMED (clicks will fire)
          - amber → 500 ms flash after `router.fired` increments
                    (i.e. an actual click was delivered)
        """
        try:
            tab = getattr(self.app, "trigger_tab", None)
            detector = getattr(tab, "detector", None) if tab else None
            router = getattr(tab, "router", None) if tab else None
        except Exception:
            detector = router = None

        now = time.time()
        armed = False
        action_name = "—"
        router_fired = 0
        progress = 0.0
        try:
            if router is not None:
                armed = bool(router.armed)
                if router.sink is not None:
                    action_name = router.sink.name
                # Router.fired = ACTUAL deliveries (armed real, or
                # dry-run). This is what the chip mirrors. Detector-
                # internal decisions that the router blocked are
                # deliberately NOT counted here.
                router_fired = int(getattr(router, "fired", 0))
        except Exception:
            pass
        # Detector.progress is fine to read for the micro-bar — it
        # shows "how close to a decision" and is independent of arm
        # state, so the operator can see the model working.
        try:
            if detector is not None:
                snap = detector.snapshot()
                progress = float(snap.get("progress", 0.0))
        except Exception:
            pass

        # Flash ONLY when router.fired actually ticks up. If the
        # router isn't armed, this counter can't increment for a
        # real sink — so the chip never flashes when disarmed.
        if router_fired > self._click_fire_count:
            self._click_fire_count = router_fired
            self._click_last_fire_ts = now
            self._click_flash_until = now + 0.5

        flashing = now < self._click_flash_until and armed
        if flashing:
            bg, fg = WARN, "#000000"
            text = f" click: FIRED · {action_name} "
        elif armed:
            bg, fg = SUCCESS, "#000000"
            text = f" click: ARMED · Action: {action_name} "
        elif detector is not None:
            bg, fg = "#0d9488", "#ffffff"
            text = " click: scanning · not armed "
        else:
            bg, fg = "#334155", "#000000"
            text = " click: idle (no model) "
        self.click_chip.configure(text=text, bg=bg, fg=fg)

        # Progress-to-fire micro-bar (safe to show always — it's just
        # the classifier's confidence build-up).
        try:
            self.click_bar.delete("all")
            w = int(self.click_bar["width"])
            h = int(self.click_bar["height"])
            fill_w = int(w * max(0.0, min(1.0, progress)))
            fill_color = SUCCESS if armed else "#0d9488"
            self.click_bar.create_rectangle(0, 0, fill_w, h,
                                            fill=fill_color, outline="")
        except Exception:
            pass

    def _toggle_advanced(self) -> None:
        self.advanced_var.set(not self.advanced_var.get())
        CONFIG.set("advanced", self.advanced_var.get())
        self._sync_advanced_label()
        self.app.apply_advanced_mode()

    def _on_profile_pick(self, _evt=None) -> None:
        name = self.profile_var.get()
        if name and (self.app.profile is None or name != self.app.profile.name):
            self.app.switch_profile(name)

    def _on_arm_pick(self) -> None:
        arm = self.arm_var.get()
        if arm not in ARMS or self.app.profile is None:
            return
        current = self.app.profile.active_arm
        if arm != current and self.app.profile.has_open_session(current):
            if not messagebox.askyesno(
                "Session open",
                f"A session is open on '{current}'. Switch to '{arm}' anyway?\n\n"
                f"The '{current}' session stays open — you can switch back.",
            ):
                self.arm_var.set(current)
                return
        self.app.profile.active_arm = arm
        self.app.profile.save()
        self.app.on_context_changed()

    def _open_link(self) -> None:
        """Start Mudra Link, or send them to the download page if absent."""
        import mudra_link

        self.link_btn.configure(state="disabled", text="Opening…")
        self.update_idletasks()
        try:
            started, message = mudra_link.launch()
        except Exception as exc:                    # never take the app down
            started, message = False, f"Could not start Mudra Link: {exc}"

        if started:
            self.app.flash(message)
        elif message == "not_installed":
            if messagebox.askyesno(
                "Mudra Link not installed",
                "Mudra Link does not appear to be installed on this PC.\n\n"
                "It is what pairs the band, and its Studio tab serves the "
                "signal this app reads.\n\nOpen the download page?",
            ):
                if not mudra_link.open_download_page():
                    messagebox.showerror(
                        "Could not open a browser",
                        f"Get Mudra Link from:\n\n{mudra_link.DOWNLOAD_URL}")
        else:
            messagebox.showerror("Could not open Mudra Link", message)

        self.link_btn.configure(state="normal", text="Open Mudra Link")

    def _repair(self) -> None:
        """Drop and rebuild the connection without losing the session."""
        client = self.app.client
        try:
            client.force_reconnect()
        except Exception as exc:
            self.app.flash(f"Could not repair the connection: {exc}", 8.0)
            return
        self.app.log_line("Repair pressed — connection dropped and rebuilding.")
        self.app.flash("Repairing the connection… this takes a few seconds. "
                       "Nothing recorded is affected.", 8.0)

    def _restart_app(self) -> None:
        """Relaunch Factum. Closes the open session cleanly first.

        The single-client WebSocket means a half-dead Factum keeps
        holding the host's only slot, so quitting properly matters more
        than it usually would — a killed process can leave the slot
        looking occupied.
        """
        if not messagebox.askyesno(
                "Restart Factum",
                "Restart the app?\n\nThe open session is closed cleanly "
                "first, so nothing recorded is lost."):
            return
        self.app.log_line("Restart requested from the header.")
        try:
            self.app.client.stop()
        except Exception:
            pass
        try:
            self.app.shutdown(restart=True)
        except Exception as exc:
            messagebox.showerror("Restart failed", str(exc))

    def _new_profile(self) -> None:
        NewProfileDialog(self, self.app)

    def add_quick_note(self) -> None:
        """Timestamp a comment mid-recording without stopping it."""
        note = self.note_var.get().strip()
        if not note or self.app.profile is None:
            return
        sess = self.app.session(create=True)
        if sess is None:
            return
        sess.append_note(note)
        self.note_var.set("")
        self.app.flash(f"Note saved to session_notes.md — “{note[:40]}”")


# ================================================================== banner


class Banner(tk.Frame):
    """One sentence telling the helper what to do. Hidden when all is well."""

    def __init__(self, master, app: "App") -> None:
        super().__init__(master, bg=BG)
        self.app = app
        self.label = tk.Label(self, text="", bg=CARD_ALT, fg=TEXT,
                              font=("Segoe UI", 10), padx=12, pady=8,
                              anchor="w", justify="left", wraplength=1100)
        self._visible = False
        self._flash_until = 0.0
        self._flash_text = ""
        self.after(400, self._tick)

    def flash(self, text: str, seconds: float = 4.0) -> None:
        self._flash_text = text
        self._flash_until = time.time() + seconds

    def _tick(self) -> None:
        text, color = self._message()
        if text:
            self.label.configure(text=text, fg=color)
            if not self._visible:
                self.label.pack(fill="x")
                self._visible = True
        elif self._visible:
            self.label.forget()
            self._visible = False
        self.after(400, self._tick)

    def _message(self) -> Tuple[str, str]:
        if time.time() < self._flash_until:
            return self._flash_text, SUCCESS

        state = self.app.client.signal_state()
        if state != STATE_LIVE:
            return self.app.client.state_message(), STATE_COLORS.get(state, TEXT_DIM)

        # Signal quality, while there is still time to fix it. A band
        # that slipped after probe three is only worth knowing about
        # during the session, not in the report on the drive home.
        quality = self.app.quality_now()
        if quality and quality["severity"] != "ok":
            return (f"{quality['headline']} — {quality['fix']}",
                    ERROR if quality["severity"] == "bad" else WARN)

        # Fatigue reminder — he tires, and nobody in the room is watching a clock.
        sess = self.app.open_session()
        if sess is not None:
            minutes = sess.elapsed_seconds() / 60.0
            limit = float(CONFIG.get("fatigue_reminder_min"))
            if limit > 0 and minutes >= limit:
                blocks = int(minutes // limit)
                return (f"Session has been running {int(minutes)} minutes. "
                        f"Time for a break — fatigue changes the signal, and "
                        f"tired repetitions are worse than no repetitions."
                        + ("" if blocks < 2 else "  (reminder #%d)" % blocks),
                        WARN)
        return "", TEXT_DIM


# ============================================================ title screen


class SplashScreen(tk.Toplevel):
    """Title card shown while the app wires itself up.

    Borderless, centred, dismissable by clicking or pressing a key, and
    it closes itself regardless — a splash that can trap the helper
    behind it is worse than no splash at all.
    """

    def __init__(self, master: tk.Tk, seconds: float, on_done) -> None:
        super().__init__(master)
        self.on_done = on_done
        self._done = False

        self.overrideredirect(True)
        self.configure(bg=BG)
        try:
            self.attributes("-topmost", True)
        except tk.TclError:
            pass

        width, height = 560, 300
        x = (self.winfo_screenwidth() - width) // 2
        y = (self.winfo_screenheight() - height) // 2
        self.geometry(f"{width}x{height}+{x}+{y}")

        # A hairline border so the card reads as a card on a dark desktop.
        frame = tk.Frame(self, bg=BG, highlightbackground=ACCENT,
                         highlightthickness=1)
        frame.pack(fill="both", expand=True)

        tk.Label(frame, text="FACTUM", bg=BG, fg=PRIMARY,
                 font=("Segoe UI Light", 52)).pack(pady=(78, 0))

        rule = tk.Frame(frame, bg=ACCENT, height=2, width=160)
        rule.pack(pady=(6, 0))
        rule.pack_propagate(False)

        tk.Label(frame, text="beyond perfection", bg=BG, fg=TEXT_DIM,
                 font=("Segoe UI", 15)).pack(pady=(14, 0))

        self.status = tk.Label(frame, text="starting…", bg=BG, fg="#334155",
                               font=("Segoe UI", 9))
        self.status.pack(side="bottom", pady=(0, 16))

        for widget in (self, frame):
            widget.bind("<Button-1>", lambda _e: self.finish())
        self.bind("<Key>", lambda _e: self.finish())
        self.focus_set()

        self.after(max(int(seconds * 1000), 200), self.finish)

    def finish(self) -> None:
        if self._done:
            return
        self._done = True
        callback, self.on_done = self.on_done, None
        try:
            self.destroy()
        finally:
            if callback is not None:
                callback()


# ================================================== recording overlay


# Cue colours — kept in one place per Section 4 of the round-4 spec.
# GO green, REST/RELAX red (was blue; blue does not read as STOP),
# countdown amber. Every colour is paired with the word AND a shape
# difference (band fills for active phases, plain background for
# still/relax) so a colour-blind operator still gets the signal.
PHASE_COLORS = {
    protocols.PREPARE: PRIMARY,     # cyan, the "get ready" band
    protocols.GO:      SUCCESS,     # green
    protocols.RELAX:   ERROR,       # red — STOP, was blue
    protocols.STILL:   ERROR,       # red — full-probe stillness = REST
    protocols.MOVE:    WARN,        # amber, distractor activity
}
COUNTDOWN_COLOR = WARN               # amber "3, 2, 1"
COUNTDOWN_LEAD_S = 3.0               # start numeral countdown this many s ahead


class PostRecordingNotesDialog(tk.Toplevel):
    """Capture what the operator saw that the numbers can't.

    Appears automatically after every probe. Non-blocking (grab_set
    is deliberately NOT called — the operator can start the next
    recording while this dialog is still open, and either their
    Save or the auto-dismiss on window close persists what they
    typed).

    Two kinds of note (toggle at the top):
      DATA — observation about the recording (stays with the probe)
      SOFTWARE — observation about the app (copied into reportedbugs/)

    The point per user spec: notes CORROBORATE the numbers, they do
    not censor them. A ticked box narrows the correlator's search,
    it does not condemn the probe. Weighting-not-exclusion. Never
    silently discard.

    Storage:
      - probes.json entry gains an `operator_notes` field.
      - session_notes.md gets a timestamped running log entry so
        the session reads as a narrative without opening the app.
      - The probe CSV header gains
        `extra.operator_notes_json` with the whole thing serialised.
    """

    CHECKBOX_ITEMS = [
        ("missed_cues",     "missed one or more cues"),
        ("band_slipped",    "band slipped or moved"),
        ("lost_connection", "lost connection during recording"),
        ("fatigued",        "felt fatigued"),
        ("distracted",      "distracted or interrupted"),
        ("felt_different",  "movement felt different than usual"),
        ("inconsistent",    "not confident this was the same movement each time"),
    ]

    def __init__(self, app, session, probe_path: str, meta,
                 on_saved=None) -> None:
        super().__init__(app)
        self.app = app
        self.session = session
        self.probe_path = probe_path
        self.meta = meta
        self.on_saved = on_saved
        self.title(f"Notes — {meta.probe}")
        self.configure(bg=BG)
        self.transient(app)
        self.resizable(False, True)
        self.geometry("640x600+%d+%d" %
                      (max(app.winfo_rootx() + 220, 20),
                       max(app.winfo_rooty() + 60, 20)))
        # Deliberately NOT modal: the operator can start the next
        # recording immediately. If they do, whatever is in the box
        # is auto-saved when the window is closed by the app.
        self.protocol("WM_DELETE_WINDOW", self._auto_save_and_close)

        card = tk.Frame(self, bg=CARD, padx=16, pady=12)
        card.pack(fill="both", expand=True, padx=10, pady=10)

        head = tk.Frame(card, bg=CARD)
        head.pack(fill="x")
        tk.Label(head, text=f"Notes for: {meta.probe}",
                 bg=CARD, fg=PRIMARY,
                 font=("Segoe UI Semibold", 13)).pack(side="left")
        tk.Label(head, text=f"({meta.kind})",
                 bg=CARD, fg=TEXT_DIM,
                 font=("Segoe UI", 10)).pack(side="left", padx=(6, 0))

        # Software-note toggle. Data notes stay with the probe;
        # software notes are copied to reportedbugs/ so Claude sees
        # them at next session start.
        self.is_software = tk.BooleanVar(value=False)
        toggle_row = tk.Frame(card, bg=CARD)
        toggle_row.pack(fill="x", pady=(6, 0))
        tk.Checkbutton(toggle_row, text="This is a SOFTWARE note "
                       "(copy to reportedbugs/)",
                       variable=self.is_software,
                       bg=CARD, fg=WARN, selectcolor=CARD_ALT,
                       activebackground=CARD, activeforeground=WARN,
                       font=("Segoe UI", 9)).pack(side="left")

        # Free-text — the main thing.
        tk.Label(card, text="What happened? (Ctrl+Enter saves)",
                 bg=CARD, fg=TEXT_DIM,
                 font=("Segoe UI", 9)).pack(anchor="w", pady=(10, 2))
        self.text = tk.Text(card, height=6, bg=CARD_ALT, fg=TEXT,
                            insertbackground=TEXT, wrap="word",
                            relief="flat", padx=10, pady=8,
                            font=("Segoe UI", 10))
        self.text.pack(fill="both", expand=True)
        self.text.focus_set()

        # Quick-tick checkboxes with optional rep-number field.
        tk.Label(card, text="Common cases (tick any that apply):",
                 bg=CARD, fg=TEXT_DIM,
                 font=("Segoe UI", 9)).pack(anchor="w", pady=(10, 2))
        cbox_frame = tk.Frame(card, bg=CARD)
        cbox_frame.pack(fill="x")
        self.check_vars: Dict[str, tk.BooleanVar] = {}
        self.rep_entries: Dict[str, tk.Entry] = {}
        for key, label in self.CHECKBOX_ITEMS:
            row = tk.Frame(cbox_frame, bg=CARD)
            row.pack(fill="x", pady=1)
            var = tk.BooleanVar(value=False)
            self.check_vars[key] = var
            tk.Checkbutton(row, text=label, variable=var,
                           bg=CARD, fg=TEXT, selectcolor=CARD_ALT,
                           activebackground=CARD, activeforeground=TEXT,
                           font=("Segoe UI", 9),
                           anchor="w", width=44).pack(side="left")
            tk.Label(row, text="rep #:", bg=CARD, fg=TEXT_DIM,
                     font=("Segoe UI", 9)).pack(side="left", padx=(6, 2))
            entry = tk.Entry(row, width=6, bg=CARD_ALT, fg=TEXT,
                             insertbackground=TEXT, relief="flat",
                             font=("Segoe UI", 9))
            entry.pack(side="left")
            self.rep_entries[key] = entry

        # Structured ratings on the same line (compact).
        tk.Label(card, text="Ratings:",
                 bg=CARD, fg=TEXT_DIM,
                 font=("Segoe UI", 9)).pack(anchor="w", pady=(10, 2))
        rate_row = tk.Frame(card, bg=CARD)
        rate_row.pack(fill="x")
        self.effort_var = tk.StringVar(value=(meta.effort or ""))
        self.fatigue_var = tk.StringVar(value=(meta.fatigue or ""))
        self.confidence_var = tk.IntVar(value=int(meta.his_confidence or 0))
        tk.Label(rate_row, text="effort:", bg=CARD, fg=TEXT_DIM,
                 font=("Segoe UI", 9)).pack(side="left")
        for v in ("easy", "moderate", "strenuous"):
            tk.Radiobutton(rate_row, text=v, variable=self.effort_var,
                           value=v, bg=CARD, fg=TEXT,
                           selectcolor=CARD_ALT, activebackground=CARD,
                           font=("Segoe UI", 9)).pack(side="left")
        tk.Label(rate_row, text="  fatigue:", bg=CARD, fg=TEXT_DIM,
                 font=("Segoe UI", 9)).pack(side="left", padx=(10, 0))
        for v in ("none", "some", "high"):
            tk.Radiobutton(rate_row, text=v, variable=self.fatigue_var,
                           value=v, bg=CARD, fg=TEXT,
                           selectcolor=CARD_ALT, activebackground=CARD,
                           font=("Segoe UI", 9)).pack(side="left")
        conf_row = tk.Frame(card, bg=CARD)
        conf_row.pack(fill="x", pady=(4, 0))
        tk.Label(conf_row, text="confidence movement was consistent (1-5):",
                 bg=CARD, fg=TEXT_DIM,
                 font=("Segoe UI", 9)).pack(side="left")
        for v in range(1, 6):
            tk.Radiobutton(conf_row, text=str(v),
                           variable=self.confidence_var, value=v,
                           bg=CARD, fg=TEXT, selectcolor=CARD_ALT,
                           activebackground=CARD,
                           font=("Segoe UI", 9)).pack(side="left")

        # Action row.
        btns = tk.Frame(card, bg=CARD)
        btns.pack(fill="x", pady=(12, 0))
        _button(btns, "Save (Ctrl+Enter)", self._save,
                bg=ACCENT, fg="#000000").pack(side="left")
        _button(btns, "Skip", self._skip,
                bg=CARD_ALT, fg=TEXT).pack(side="left", padx=(6, 0))
        _button(btns, "Discard recording",
                self._discard, bg=CARD, fg=ERROR
                ).pack(side="right")

        self.bind("<Control-Return>", lambda _e: self._save())
        self.bind("<Escape>", lambda _e: self._skip())

    # ---------------------------------------------------------- capture

    def _collect(self) -> dict:
        text = self.text.get("1.0", "end").strip()
        ticks = {}
        for key, _ in self.CHECKBOX_ITEMS:
            if self.check_vars[key].get():
                ticks[key] = {
                    "ticked": True,
                    "rep": self.rep_entries[key].get().strip() or None,
                }
        return {
            "text":       text,
            "checked":    ticks,
            "effort":     self.effort_var.get() or "",
            "fatigue":    self.fatigue_var.get() or "",
            "confidence": int(self.confidence_var.get() or 0),
            "is_software": bool(self.is_software.get()),
            "captured_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ",
                                          time.gmtime()),
        }

    def _empty(self, note: dict) -> bool:
        return (not note["text"]
                and not note["checked"]
                and not note["effort"]
                and not note["fatigue"]
                and not note["confidence"])

    # ---------------------------------------------------------- save

    def _save(self) -> None:
        note = self._collect()
        self._persist(note, status="saved")
        self.destroy()

    def _skip(self) -> None:
        note = self._collect()
        # Skipping IS information — record that no observation was made.
        self._persist(note, status="skipped")
        self.destroy()

    def _discard(self) -> None:
        if not messagebox.askyesno(
            "Discard this recording?",
            "Mark this recording as rejected? The file will be KEPT on "
            "disk — nothing is deleted — but training and analysis will "
            "skip it. You can undo this later from the Profile tab."):
            return
        note = self._collect()
        note["discard"] = True
        # Force a reason so a discarded probe always has one.
        if not note["text"]:
            note["text"] = "(discarded without reason given)"
        self._persist(note, status="discarded")
        self.destroy()

    def _auto_save_and_close(self) -> None:
        """Window closed by app/OS — persist whatever's in the box."""
        note = self._collect()
        if not self._empty(note):
            self._persist(note, status="auto")
        self.destroy()

    def _persist(self, note: dict, status: str) -> None:
        """Write into probes.json, session_notes.md, CSV header, and —
        if it's a software note — reportedbugs/."""
        import json as _json
        fname = os.path.basename(self.probe_path)
        note["status"] = status
        # 1) probes.json
        try:
            self.session.update_probe(fname, operator_notes=note)
        except Exception:
            pass
        # 2) session_notes.md — narrative log
        try:
            log_path = os.path.join(self.session.root, "session_notes.md")
            lines = []
            stamp = time.strftime("%H:%M:%S")
            lines.append(f"\n## {stamp} — {self.meta.probe} "
                         f"({self.meta.kind}) — {status}")
            if note["text"]:
                lines.append("")
                for row in note["text"].splitlines():
                    lines.append(f"> {row}")
            if note["checked"]:
                lines.append("")
                lines.append("Ticked:")
                for k, v in note["checked"].items():
                    rep = f" (rep {v['rep']})" if v["rep"] else ""
                    lines.append(f"- {k}{rep}")
            if note["effort"] or note["fatigue"] or note["confidence"]:
                lines.append("")
                lines.append(f"effort={note['effort'] or '-'}   "
                             f"fatigue={note['fatigue'] or '-'}   "
                             f"confidence={note['confidence']}")
            if note.get("discard"):
                lines.append("")
                lines.append("**DISCARDED — do not train on this probe.**")
            with open(log_path, "a", encoding="utf-8") as f:
                f.write("\n".join(lines) + "\n")
        except Exception:
            pass
        # 3) CSV header (serialised, so a reader-with-no-code can see it).
        try:
            # Rewrite the probe CSV header to include operator_notes_json.
            _rewrite_probe_header(self.probe_path,
                                  operator_notes_json=_json.dumps(note))
        except Exception:
            pass
        # 4) Mirror to reportedbugs/ if it's a software note.
        if note["is_software"] and note["text"]:
            try:
                root = Path(__file__).resolve().parent.parent
                folder = root / "reportedbugs"
                folder.mkdir(exist_ok=True)
                stamp = time.strftime("%Y-%m-%d_%H%M%S")
                slug = "post-recording"
                path = folder / f"{stamp}_{slug}_from_probe.md"
                path.write_text(
                    "\n".join([
                        f"# {stamp} — post-recording software note",
                        "",
                        "## Context",
                        f"- probe: {self.meta.probe}",
                        f"- kind: {self.meta.kind}",
                        f"- session: {self.session.stamp}",
                        f"- profile: {self.meta.profile}",
                        f"- arm: {self.meta.arm}",
                        f"- probe file: {os.path.basename(self.probe_path)}",
                        "",
                        "## Report",
                        "",
                        note["text"],
                        "",
                    ]),
                    encoding="utf-8")
            except Exception:
                pass
        # 5) Trigger downstream refresh so the note shows up in the
        # library view without a manual refresh.
        try:
            if self.on_saved is not None:
                self.on_saved()
        except Exception:
            pass


def _rewrite_probe_header(path: str, **extra_fields) -> None:
    """Append/replace `# extra.<key>: <value>` lines in a probe CSV.

    The CSV keeps its sample rows byte-for-byte; only the `# extra.`
    lines are added/updated. Values are put on a single line
    (JSON serialised strings included) so downstream parsers stay
    happy.
    """
    try:
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
    except Exception:
        return
    header_lines: List[str] = []
    body: List[str] = []
    in_header = True
    for line in content.splitlines():
        if in_header and line.startswith("#"):
            header_lines.append(line)
            continue
        in_header = False
        body.append(line)
    # Replace-or-append each extra field.
    for key, value in extra_fields.items():
        prefix = f"# extra.{key}:"
        found = False
        for i, line in enumerate(header_lines):
            if line.startswith(prefix):
                header_lines[i] = f"{prefix} {value}"
                found = True
                break
        if not found:
            header_lines.append(f"{prefix} {value}")
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write("\n".join(header_lines) + "\n")
        f.write("\n".join(body))
        if body and not content.endswith("\n"):
            pass
        else:
            f.write("\n")


def _describe_widget(w, depth: int = 0) -> dict:
    """Snapshot of a widget: class, semantic name, text/value, geometry."""
    if w is None:
        return {}
    try:
        cls = w.winfo_class()
    except Exception:
        cls = type(w).__name__
    info = {
        "name": widget_name(w),
        "class": cls,
        "path": str(w) if hasattr(w, "winfo_pathname") else repr(w),
    }
    # Try to read the visible text or value.
    for attr in ("text", "textvariable"):
        try:
            v = w.cget(attr)
            if attr == "textvariable" and v:
                try:
                    v = w.getvar(v)
                except Exception:
                    v = ""
            if v:
                info["text"] = str(v).strip()
                break
        except Exception:
            continue
    # Entry / Text values
    if "text" not in info:
        try:
            if isinstance(w, tk.Entry):
                info["text"] = w.get()
            elif isinstance(w, tk.Text):
                info["text"] = w.get("1.0", "end-1c").strip()
        except Exception:
            pass
    # Geometry
    try:
        info["geometry"] = (f"{w.winfo_width()}x{w.winfo_height()} "
                            f"at ({w.winfo_rootx()}, {w.winfo_rooty()})")
    except Exception:
        pass
    return info


def _tab_for_widget(w) -> str:
    """Best-effort: which Notebook tab does this widget belong to?"""
    try:
        cur = w
        for _ in range(30):
            if cur is None:
                return ""
            if isinstance(cur, ttk.Notebook):
                try:
                    return cur.tab(cur.select(), "text").strip()
                except Exception:
                    return ""
            parent = cur.master
            # Also detect being a direct tab: walk up until we hit a
            # Notebook whose select() matches an ancestor.
            if isinstance(parent, ttk.Notebook):
                try:
                    for tab_id in parent.tabs():
                        if parent.nametowidget(tab_id) is cur or \
                           str(cur).startswith(str(parent.nametowidget(tab_id))):
                            return parent.tab(tab_id, "text").strip()
                except Exception:
                    pass
            cur = parent
    except Exception:
        return ""
    return ""


def capture_widget_neighborhood(w) -> dict:
    """Widget + parents + immediate children + siblings, per user spec.

    Returned dict is the "whole neighbourhood" — Claude reads the
    user's note alongside this and picks the right node. That is the
    disambiguation strategy per the spec: my note is the disambiguator.
    """
    self_info = _describe_widget(w)
    self_info["tab"] = _tab_for_widget(w)
    # Parent chain up to top-level (max 20 hops).
    parents = []
    try:
        cur = w.master
        for _ in range(20):
            if cur is None or isinstance(cur, (tk.Tk, tk.Toplevel)):
                if cur is not None:
                    parents.append(_describe_widget(cur))
                break
            parents.append(_describe_widget(cur))
            cur = cur.master
    except Exception:
        pass
    # Immediate children.
    children = []
    try:
        for ch in w.winfo_children():
            children.append(_describe_widget(ch))
    except Exception:
        pass
    # Siblings (same master, excluding self).
    siblings = []
    try:
        m = w.master
        if m is not None:
            for sib in m.winfo_children():
                if sib is w:
                    continue
                siblings.append(_describe_widget(sib))
    except Exception:
        pass
    return {
        "self":     self_info,
        "parents":  parents,
        "children": children,
        "siblings": siblings,
    }


class WidgetPicker:
    """Bulletproof pick mode. All five escape routes wired.

    Used from BugReportDialog. Enters pick mode, tracks the widget
    under the cursor, highlights it, and returns it on click. Any
    escape route calls `_teardown` which unbinds everything, cancels
    the timeout, destroys the overlay + banner, and calls the
    supplied `on_result` callback with the picked widget (or None).

    Never leaves bindings installed on exit. Every handler is wrapped
    in try/except so a raised exception still tears down cleanly.
    """
    TIMEOUT_MS = 30_000

    def __init__(self, root: tk.Misc,
                 on_result: Callable[[Optional[tk.Widget], bool], None]) -> None:
        self.root = root
        self.on_result = on_result
        self.active = False
        self._overlay: Optional[tk.Toplevel] = None
        self._label_win: Optional[tk.Toplevel] = None
        self._label_var: Optional[tk.StringVar] = None
        self._banner: Optional[tk.Toplevel] = None
        self._timeout_id: Optional[str] = None
        self._exclude: List[tk.Misc] = []

    def start(self, exclude: Optional[List[tk.Misc]] = None) -> None:
        if self.active:
            return
        self.active = True
        self._exclude = list(exclude or [])
        try:
            self._install_overlay()
            self._install_label()
            self._install_banner()
            self._install_bindings()
            self._timeout_id = self.root.after(self.TIMEOUT_MS,
                                               self._on_timeout)
        except Exception:
            # Any failure during setup: tear down first, then re-raise.
            self._teardown(picked=None, cancelled=True)
            raise

    # -- setup --

    def _install_overlay(self) -> None:
        ov = tk.Toplevel(self.root)
        ov.overrideredirect(True)
        try:
            ov.attributes("-topmost", True)
            ov.attributes("-alpha", 0.35)
        except Exception:
            pass
        # A single visible-outline frame. Repositioned per motion tick.
        ov.configure(bg=WARN)
        ov.geometry("1x1+0+0")
        ov.withdraw()
        self._overlay = ov

    def _install_label(self) -> None:
        lw = tk.Toplevel(self.root)
        lw.overrideredirect(True)
        try:
            lw.attributes("-topmost", True)
        except Exception:
            pass
        lw.configure(bg=CARD_ALT, padx=6, pady=3, highlightthickness=1,
                     highlightbackground=WARN)
        self._label_var = tk.StringVar(value="hover a widget…")
        tk.Label(lw, textvariable=self._label_var, bg=CARD_ALT, fg=WARN,
                 font=("Consolas", 9)).pack()
        lw.withdraw()
        self._label_win = lw

    def _install_banner(self) -> None:
        b = tk.Toplevel(self.root)
        b.overrideredirect(True)
        try:
            b.attributes("-topmost", True)
        except Exception:
            pass
        b.configure(bg=ERROR, padx=14, pady=8)
        tk.Label(b, text="PICK MODE — click a widget, right-click or "
                         "Esc to cancel (auto-exits in 30 s)",
                 bg=ERROR, fg="#ffffff",
                 font=("Segoe UI Semibold", 11)).pack(side="left")
        _button(b, "Cancel (Esc)",
                lambda: self._teardown(picked=None, cancelled=True),
                bg="#7f1d1d", fg="#ffffff").pack(side="left", padx=(10, 0))
        # Positioned at the top-centre of the screen.
        b.update_idletasks()
        w = b.winfo_reqwidth()
        try:
            screen_w = self.root.winfo_screenwidth()
            x = max(10, (screen_w - w) // 2)
        except Exception:
            x = 20
        b.geometry(f"+{x}+8")
        self._banner = b

    def _install_bindings(self) -> None:
        # Save the tag IDs so we can unbind them individually — this
        # is the "verify binding fully removed" requirement.
        self._binds = {
            "<Motion>":   self.root.bind_all("<Motion>",   self._safe(self._on_motion)),
            "<Button-1>": self.root.bind_all("<Button-1>", self._safe(self._on_click),
                                             add="+"),
            "<Button-3>": self.root.bind_all("<Button-3>", self._safe(self._on_cancel),
                                             add="+"),
            "<Escape>":   self.root.bind_all("<Escape>",   self._safe(self._on_cancel),
                                             add="+"),
        }

    # -- handlers, all wrapped by _safe so a raise still tears down --

    def _safe(self, fn):
        def wrapper(event=None):
            try:
                return fn(event)
            except Exception:
                self._teardown(picked=None, cancelled=True)
        return wrapper

    def _widget_under(self, event) -> Optional[tk.Widget]:
        try:
            w = self.root.winfo_containing(event.x_root, event.y_root)
        except Exception:
            return None
        # Skip our own overlay / banner / label windows so we don't
        # end up "picking" our own scaffolding.
        cur = w
        while cur is not None:
            if cur is self._overlay or cur is self._label_win \
               or cur is self._banner or cur in self._exclude:
                return None
            try:
                cur = cur.master
            except Exception:
                cur = None
        return w

    def _on_motion(self, event):
        w = self._widget_under(event)
        if w is None:
            if self._overlay is not None:
                self._overlay.withdraw()
            if self._label_win is not None:
                self._label_win.withdraw()
            return
        # Position the highlight rectangle over the widget's bbox.
        try:
            x = w.winfo_rootx()
            y = w.winfo_rooty()
            wpx = max(w.winfo_width(), 1)
            hpx = max(w.winfo_height(), 1)
            self._overlay.geometry(f"{wpx}x{hpx}+{x}+{y}")
            self._overlay.deiconify()
        except Exception:
            pass
        # Label that follows the cursor.
        try:
            name = widget_name(w)
            cls = w.winfo_class()
            self._label_var.set(f"{name}  ({cls})")
            self._label_win.geometry(f"+{event.x_root + 14}+{event.y_root + 14}")
            self._label_win.deiconify()
            self._label_win.lift()
        except Exception:
            pass

    def _on_click(self, event):
        # Alt-click selects the PARENT of the widget under cursor.
        w = self._widget_under(event)
        if w is None:
            return "break"
        try:
            if (event.state & 0x20000) or (event.state & 0x0008):
                # Alt modifier held (state bits vary by platform)
                if w.master is not None:
                    w = w.master
        except Exception:
            pass
        self._teardown(picked=w, cancelled=False)
        return "break"

    def _on_cancel(self, _event=None):
        self._teardown(picked=None, cancelled=True)
        return "break"

    def _on_timeout(self):
        self._teardown(picked=None, cancelled=True)

    # -- teardown --

    def _teardown(self, picked, cancelled: bool) -> None:
        if not self.active:
            return
        self.active = False
        # Cancel timeout.
        try:
            if self._timeout_id is not None:
                self.root.after_cancel(self._timeout_id)
        except Exception:
            pass
        self._timeout_id = None
        # Unbind — remove the exact IDs we installed, not just an
        # unbind_all() which would clobber other bindings.
        try:
            for seq, tag in getattr(self, "_binds", {}).items():
                try:
                    self.root.unbind_all(seq)
                except Exception:
                    pass
        except Exception:
            pass
        self._binds = {}
        # Destroy scaffolding.
        for w_ref in ("_overlay", "_label_win", "_banner"):
            w = getattr(self, w_ref, None)
            if w is not None:
                try:
                    w.destroy()
                except Exception:
                    pass
                setattr(self, w_ref, None)
        # Callback last — if it raises, the picker is already clean.
        try:
            self.on_result(picked, cancelled)
        except Exception:
            pass


class BugReportDialog(tk.Toplevel):
    """One-click bug capture — always reachable from the top bar.

    Optimises for the case where the operator writes one sentence
    mid-session and moves on. Auto-captures the context we would
    otherwise have to ask for:
      - active tab / page (best-effort)
      - active profile and arm
      - whether a recording is in progress
      - connection state and samples/s
      - app timestamp
      - last N lines of the mudra_client log
    Ctrl+Enter saves, Escape cancels. Written into
    `reportedbugs/<stamp>_<page>.md` — one file per report,
    markdown, newest-first when listed. Never deletes; when
    addressed, files move to `reportedbugs/done/`.
    """

    def __init__(self, app) -> None:
        super().__init__(app)
        self.app = app
        self.title("Report a bug")
        self.configure(bg=BG)
        self.transient(app)
        self.resizable(False, True)
        self.geometry("620x520+%d+%d" %
                      (max(app.winfo_rootx() + 240, 20),
                       max(app.winfo_rooty() + 100, 20)))
        self.protocol("WM_DELETE_WINDOW", self._cancel)

        card = tk.Frame(self, bg=CARD, padx=16, pady=14)
        card.pack(fill="both", expand=True, padx=10, pady=10)

        tk.Label(card, text="Report a bug", bg=CARD, fg=ERROR,
                 font=("Segoe UI Semibold", 14)).pack(anchor="w")
        tk.Label(card,
                 text="One sentence is fine. Ctrl+Enter to save, "
                      "Esc to cancel. Context is captured automatically.",
                 bg=CARD, fg=TEXT_DIM,
                 font=("Segoe UI", 9)).pack(anchor="w", pady=(2, 8))

        # Pick-widget button + picked list.
        pick_row = tk.Frame(card, bg=CARD)
        pick_row.pack(fill="x", pady=(2, 4))
        recording = bool(getattr(app, "_recording_in_progress", False))
        pick_btn = _button(pick_row,
                           "Pick widget…"
                           if not recording
                           else "Pick widget (disabled — recording)",
                           self._start_pick,
                           bg=CARD_ALT, fg=PRIMARY)
        pick_btn.pack(side="left")
        if recording:
            pick_btn.configure(state="disabled")
        tk.Label(pick_row,
                 text=("Alt-click picks the parent. "
                       "Right-click or Esc cancels."),
                 bg=CARD, fg=TEXT_DIM,
                 font=("Segoe UI", 9)).pack(side="left", padx=(10, 0))

        # Chip list of picked widgets.
        self._picks: List[dict] = []
        self.picks_frame = tk.Frame(card, bg=CARD)
        self.picks_frame.pack(fill="x", pady=(2, 6))
        self._render_picks()

        self.text = tk.Text(card, height=9, bg=CARD_ALT, fg=TEXT,
                            insertbackground=TEXT, wrap="word",
                            relief="flat", padx=10, pady=8,
                            font=("Segoe UI", 10))
        self.text.pack(fill="both", expand=True)
        self.text.focus_set()

        row = tk.Frame(card, bg=CARD)
        row.pack(fill="x", pady=(10, 0))
        _button(row, "Save (Ctrl+Enter)", self._save,
                bg=ACCENT, fg="#000000").pack(side="left")
        _button(row, "Cancel (Esc)", self._cancel,
                bg=CARD, fg=TEXT_DIM).pack(side="left", padx=(6, 0))

        # Bind on the dialog only — NOT bind_all — so Esc / Ctrl+Enter
        # here don't leak into pick mode's own bindings.
        self.bind("<Control-Return>", lambda _e: self._save())
        self.bind("<Escape>", lambda _e: self._cancel())
        self.grab_set()

    def _render_picks(self) -> None:
        for c in list(self.picks_frame.winfo_children()):
            c.destroy()
        if not self._picks:
            tk.Label(self.picks_frame,
                     text="(no widgets picked — optional)",
                     bg=CARD, fg=TEXT_DIM,
                     font=("Segoe UI", 9, "italic")).pack(anchor="w")
            return
        for i, pick in enumerate(self._picks):
            row = tk.Frame(self.picks_frame, bg=CARD_ALT, padx=6, pady=3)
            row.pack(fill="x", pady=1)
            self_info = pick["self"]
            label = f"{self_info['name']}  ({self_info['class']})"
            if self_info.get("text"):
                snippet = self_info["text"][:44]
                label += f"  — \"{snippet}\""
                if len(self_info["text"]) > 44:
                    label += "…"
            tk.Label(row, text=label, bg=CARD_ALT, fg=TEXT,
                     font=("Consolas", 9)).pack(side="left")
            _button(row, "×",
                    lambda idx=i: self._remove_pick(idx),
                    bg=CARD, fg=ERROR).pack(side="right")

    def _remove_pick(self, idx: int) -> None:
        try:
            del self._picks[idx]
            self._render_picks()
        except Exception:
            pass

    def _start_pick(self) -> None:
        if getattr(self.app, "_recording_in_progress", False):
            self.app.flash("Pick mode is disabled during a recording.")
            return
        # Move the dialog aside so it doesn't obscure the app.
        try:
            self._prev_geom = self.geometry()
            self.iconify()
        except Exception:
            self._prev_geom = None
        # Kick off the picker on the root, excluding our own dialog
        # and its scaffolding so we can't pick ourselves.
        try:
            self.grab_release()
        except Exception:
            pass
        picker = WidgetPicker(self.app, on_result=self._picker_done)
        try:
            picker.start(exclude=[self])
        except Exception as exc:
            self._picker_done(None, cancelled=True)
            messagebox.showerror("Pick mode failed",
                                 f"Could not enter pick mode: {exc}\n\n"
                                 "The dialog is back — try again or "
                                 "just type the report.")

    def _picker_done(self, widget, cancelled: bool) -> None:
        # Restore the dialog, retake grab, capture the neighborhood.
        try:
            self.deiconify()
            if self._prev_geom:
                self.geometry(self._prev_geom)
            self.lift()
            self.focus_force()
            self.grab_set()
        except Exception:
            pass
        if widget is None or cancelled:
            return
        try:
            neighborhood = capture_widget_neighborhood(widget)
            self._picks.append(neighborhood)
            self._render_picks()
        except Exception as exc:
            messagebox.showerror("Could not capture widget",
                                 f"{exc}\n\nType a description instead.")

    def _capture_context(self) -> dict:
        app = self.app
        ctx = {"timestamp_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ",
                                              time.gmtime())}
        try:
            nb = getattr(app, "notebook", None)
            if nb is not None:
                ctx["active_tab"] = nb.tab(nb.select(), "text").strip()
        except Exception:
            pass
        try:
            prof = app.profile
            ctx["profile"] = prof.name if prof else ""
            ctx["profile_type"] = prof.type if prof else ""
            ctx["arm"] = prof.active_arm if prof else ""
        except Exception:
            pass
        try:
            ctx["recording_in_progress"] = bool(
                getattr(app, "_recording_in_progress", False))
        except Exception:
            pass
        try:
            state = app.client.signal_state()
            ctx["connection_state"] = state
            ctx["samples_per_second"] = round(app.client.samples_per_second(), 1)
            ctx["frames_received"] = int(app.client.frames_received)
            ctx["samples_received"] = int(app.client.samples_received)
        except Exception:
            pass
        try:
            tail_log = list(app.client.log)[-12:]
            ctx["last_log_lines"] = [f"{time.strftime('%H:%M:%S', time.localtime(ts))}  {msg}"
                                     for ts, msg in tail_log]
        except Exception:
            pass
        return ctx

    def _save(self) -> None:
        text = self.text.get("1.0", "end").strip()
        if not text:
            self._cancel()
            return
        ctx = self._capture_context()
        # Filename: <YYYY-MM-DD_HHMM>_<page-slug>.md, page slug from
        # the active tab (safe chars only).
        stamp = time.strftime("%Y-%m-%d_%H%M")
        page = ctx.get("active_tab", "unknown")
        page_slug = "".join(c if c.isalnum() else "-" for c in page.lower())[:32].strip("-")
        page_slug = page_slug or "unknown"
        # `reportedbugs/` at project root (parent of `armband/`).
        root = Path(__file__).resolve().parent.parent
        folder = root / "reportedbugs"
        folder.mkdir(exist_ok=True)
        path = folder / f"{stamp}_{page_slug}.md"
        # Header block: auto-captured context; picked widgets;
        # then the operator's text.
        lines = [f"# {stamp} — {page}", ""]
        lines.append("## Context")
        lines.append("")
        for k, v in ctx.items():
            if isinstance(v, list):
                lines.append(f"- **{k}**:")
                for item in v:
                    lines.append(f"    - {item}")
            else:
                lines.append(f"- **{k}**: {v}")
        if self._picks:
            lines.extend(["", "## Picked", ""])
            for pick in self._picks:
                s = pick["self"]
                lines.append(f"### {s['name']}  ({s['class']})")
                if s.get("text"):
                    lines.append(f"- text:     {s['text']!r}")
                if s.get("tab"):
                    lines.append(f"- tab:      {s['tab']}")
                if s.get("geometry"):
                    lines.append(f"- geometry: {s['geometry']}")
                if pick.get("parents"):
                    pp = " > ".join(f"{p['name']} ({p['class']})"
                                    for p in pick["parents"])
                    lines.append(f"- parents:  {pp}")
                if pick.get("children"):
                    lines.append(f"- children:")
                    for c in pick["children"]:
                        txt = f", {c['text']!r}" if c.get("text") else ""
                        lines.append(f"    - {c['name']} ({c['class']}{txt})")
                else:
                    lines.append("- children: none")
                if pick.get("siblings"):
                    lines.append(f"- siblings:")
                    for sib in pick["siblings"]:
                        txt = f", {sib['text']!r}" if sib.get("text") else ""
                        lines.append(f"    - {sib['name']} ({sib['class']}{txt})")
                lines.append("")
        lines.extend(["", "## Report", "", text, ""])
        try:
            path.write_text("\n".join(lines), encoding="utf-8")
        except Exception as exc:
            messagebox.showerror("Could not save bug report",
                                 f"{exc}\n\nText not lost — copy it out.")
            return
        self.destroy()
        try:
            self.app.flash(f"Bug report saved: {path.name}")
        except Exception:
            pass

    def _cancel(self) -> None:
        try:
            self.unbind_all("<Control-Return>")
            self.unbind_all("<Escape>")
        except Exception:
            pass
        self.destroy()


class PlacementConfirmDialog(tk.Toplevel):
    """Modal shown once per session before the first recording.

    Item 4 of the implementation queue. Pre-populates with the last
    saved placement for this arm and shows how long ago it was set.
    Operator confirms or is bounced to the Contact & Placement tab
    to adjust. Confirmed placement is written into the session
    record and into every subsequent probe CSV header for this
    session (via the existing placement contract flow).

    The point is that placement is a per-session commitment, not a
    profile default. A band knocked out of position by even 15 deg
    puts an electrode over the wrong muscle group and every
    subsequent metric in that session is meaningless.
    """

    def __init__(self, app, session,
                 on_confirm: Callable[[], None],
                 on_adjust: Callable[[], None]) -> None:
        super().__init__(app)
        self.app = app
        self.session = session
        self.on_confirm = on_confirm
        self.on_adjust = on_adjust
        self.title("Confirm placement for this session")
        self.configure(bg=BG)
        self.transient(app)
        self.resizable(False, False)
        self.geometry("560x260+%d+%d" %
                      (max(app.winfo_rootx() + 260, 20),
                       max(app.winfo_rooty() + 140, 20)))
        self.protocol("WM_DELETE_WINDOW", self._cancel)

        prof = app.profile
        placement = prof.placement(session.arm) if prof else None
        limb = prof.limb(session.arm) if prof else None
        age_str = self._age(placement)

        card = tk.Frame(self, bg=CARD, padx=18, pady=14)
        card.pack(fill="both", expand=True, padx=12, pady=12)
        tk.Label(card, text="Confirm placement before recording",
                 bg=CARD, fg=PRIMARY,
                 font=("Segoe UI Semibold", 14)).pack(anchor="w")
        tk.Label(card, text=f"Arm: {session.arm.upper()}",
                 bg=CARD, fg=TEXT_DIM,
                 font=("Segoe UI", 10)).pack(anchor="w", pady=(2, 8))
        if placement is None:
            body = ("No placement recorded yet for this arm. "
                    "Open the Contact & Placement tab, set the band "
                    "position on the diagram, and come back.")
            colour = WARN
        else:
            body = (f"Last saved placement: {placement.describe()}.\n"
                    f"{age_str}\n\n"
                    "Confirm the band is in exactly this position. "
                    "If it has moved, adjust it — a change of even "
                    "15° puts an electrode over the wrong muscle "
                    "and this session's numbers will not match "
                    "earlier ones.")
            colour = TEXT
        tk.Label(card, text=body, bg=CARD, fg=colour,
                 font=("Segoe UI", 10), justify="left",
                 wraplength=480).pack(anchor="w")

        row = tk.Frame(card, bg=CARD)
        row.pack(anchor="w", pady=(14, 0))
        confirm_state = "normal" if placement is not None else "disabled"
        _button(row, "Confirm — start recording",
                self._confirm, bg=ACCENT, fg="#000000"
                ).pack(side="left", padx=(0, 6))
        _button(row, "Adjust in Contact & Placement",
                self._adjust, bg=CARD_ALT, fg=TEXT
                ).pack(side="left", padx=(0, 6))
        _button(row, "Cancel", self._cancel, bg=CARD, fg=ERROR
                ).pack(side="left")

        self.grab_set()

    def _age(self, placement) -> str:
        if placement is None:
            return "(none set yet)"
        prof = self.app.profile
        if not prof:
            return ""
        # Fetch age from placement_notes.md's last line timestamp.
        try:
            notes = prof.read_placement_notes(self.session.arm) or ""
            last = notes.strip().splitlines()[-1] if notes.strip() else ""
            if last.startswith("- "):
                stamp = last[2:].split(" — ", 1)[0]
                return f"Last set at {stamp}"
        except Exception:
            pass
        return ""

    def _confirm(self):
        setattr(self.session, "_placement_confirmed", True)
        setattr(self.session, "_placement_confirmed_at", time.time())
        # Log into session notes so the confirmation itself is
        # audited alongside the samples.
        try:
            self.app.profile.log(
                "placement confirmed for session start",
                action="placement_confirm",
                arm=self.session.arm, session=self.session.stamp)
        except Exception:
            pass
        self.destroy()
        self.on_confirm()

    def _adjust(self):
        self.destroy()
        self.on_adjust()

    def _cancel(self):
        self.destroy()


class RecordingOverlay(tk.Toplevel):
    """Cue the attempt, then capture it — streaming to disk as it lands.

    The window is deliberately large and readable from across a room:
    the person doing the movement is looking at this, not at the app.
    A full-width colour band says GO or RELAX, a big number counts down
    the current phase, and a timeline shows what is coming.

    Cueing is the point. Without it the analysis has to guess where one
    attempt ended and the next began; with it, the schedule is recorded
    alongside the samples and becomes ground truth.

    Nothing is held in memory waiting for the end. If this window, the
    app, or the machine dies mid-probe, the CSV on disk still holds
    everything recorded up to that moment, marked `status: incomplete`.
    """

    def __init__(self, app: "App", session: Session, probe_name: str,
                 kind: str, duration_s: int, on_done,
                 protocol_key: str = protocols.DEFAULT_KEY) -> None:
        super().__init__(app)
        self.app = app
        self.session = session
        self.probe_name = probe_name
        self.kind = kind
        self.on_done = on_done

        self.protocol_key = protocol_key
        self.proto = protocols.get(protocol_key)
        self.phases = self.proto.phases(
            movement=probe_name,
            duration_s=duration_s,
            n_reps=int(CONFIG.get("protocol_reps")),
            hold_s=float(CONFIG.get("protocol_hold_s")),
            relax_s=float(CONFIG.get("protocol_relax_s")),
            prepare_s=float(CONFIG.get("countdown_s")),
        )
        self.duration_s = self.phases[-1].end_s if self.phases else duration_s
        self.cues = protocols.go_windows(self.phases)

        self.title(f"Recording — {probe_name}")
        self.configure(bg=BG)
        self.transient(app)
        self.resizable(False, False)
        self.geometry("760x520+%d+%d" % (max(app.winfo_rootx() + 180, 20),
                                         max(app.winfo_rooty() + 90, 20)))
        self.protocol("WM_DELETE_WINDOW", self._cancel)

        # -- header: what is being recorded
        head = tk.Frame(self, bg=CARD, padx=18, pady=10)
        head.pack(fill="x")
        tk.Label(head, text=probe_name, bg=CARD, fg=TEXT,
                 font=("Segoe UI Semibold", 16)).pack(side="left")
        tk.Label(head, text=self.proto.name, bg=CARD, fg=TEXT_DIM,
                 font=("Segoe UI", 10)).pack(side="right")

        # -- the cue band: the thing the person actually watches
        self.cue_band = tk.Frame(self, bg=CARD_ALT, height=210)
        self.cue_band.pack(fill="x")
        self.cue_band.pack_propagate(False)
        self.phase_lbl = tk.Label(self.cue_band, text="Get ready", bg=CARD_ALT,
                                  fg=PRIMARY, font=("Segoe UI Semibold", 40))
        self.phase_lbl.pack(pady=(30, 0))
        self.detail_lbl = tk.Label(self.cue_band, text="", bg=CARD_ALT,
                                   fg=TEXT, font=("Segoe UI", 13),
                                   wraplength=700, justify="center")
        self.detail_lbl.pack(pady=(8, 0))
        self.phase_clock = tk.Label(self.cue_band, text="", bg=CARD_ALT,
                                    fg=TEXT_DIM, font=("Consolas", 30, "bold"))
        self.phase_clock.pack(pady=(6, 0))
        # "Rep 3 of 20" — the whole-probe progress indicator. Only
        # rendered when the protocol has multiple cued reps.
        self.rep_lbl = tk.Label(self.cue_band, text="", bg=CARD_ALT,
                                fg=TEXT_DIM, font=("Segoe UI Semibold", 14))
        self.rep_lbl.pack(pady=(4, 0))

        # -- timeline of the whole protocol
        tl = tk.Frame(self, bg=BG, padx=18, pady=10)
        tl.pack(fill="x")
        self.timeline = tk.Canvas(tl, height=34, bg=BG, highlightthickness=0)
        self.timeline.pack(fill="x")
        self.next_lbl = tk.Label(tl, text="", bg=BG, fg=TEXT_DIM,
                                 font=("Segoe UI", 10))
        self.next_lbl.pack(anchor="w", pady=(6, 0))

        # -- footer
        foot = tk.Frame(self, bg=BG, padx=18)
        foot.pack(fill="x", pady=(4, 0))
        self.samples_var = tk.StringVar(value="")
        tk.Label(foot, textvariable=self.samples_var, bg=BG, fg=TEXT_DIM,
                 font=("Consolas", 9)).pack(anchor="w")
        # Live per-channel clip indicator (Item 5). Each channel's
        # rolling clip% is shown; turns red the moment any channel
        # is materially clipping so the operator can reseat the
        # electrode in the room instead of finding out at analysis.
        clip_row = tk.Frame(foot, bg=BG)
        clip_row.pack(anchor="w", pady=(2, 0))
        tk.Label(clip_row, text="clip% (last 1 s):", bg=BG, fg=TEXT_DIM,
                 font=("Consolas", 9)).pack(side="left")
        self._clip_ch_labels: List[tk.Label] = []
        for ch in range(3):
            lbl = tk.Label(clip_row, text=f"ch{ch+1} —", bg=BG, fg=TEXT_DIM,
                           font=("Consolas", 9, "bold"), padx=6)
            lbl.pack(side="left")
            self._clip_ch_labels.append(lbl)
        self.progress = ttk.Progressbar(foot, mode="determinate", maximum=100)
        self.progress.pack(fill="x", pady=(6, 10))
        row = tk.Frame(foot, bg=BG)
        row.pack(pady=(0, 12))
        _button(row, "Stop and keep", self._stop_early, bg=CARD,
                fg=TEXT).pack(side="left", padx=4)
        _button(row, "Cancel", self._cancel, bg=CARD, fg=ERROR).pack(side="left", padx=4)

        self._writer: Optional[ProbeWriter] = None
        self._path = ""
        self._cancelled = False
        self._recording = False
        # Monotonic clock — wallclock (time.time) can jump on system
        # clock adjustments mid-recording, drifting the whole cue
        # schedule out of sync with the samples. `time.monotonic` is
        # what a measurement instrument uses. See STATUS.md, item 2
        # of the implementation queue: one authoritative timeline.
        self._t_started_mono = 0.0
        self._t_started_wall = 0.0
        self._last_total = 0
        self._rate, self._rate_source = self._measured_rate()
        self._last_phase: Optional[protocols.Phase] = None
        # Actual displayed phase transitions, as the operator saw them.
        # Written into the CSV header at close so a phase-vs-sample
        # audit can compare intended-schedule against
        # actually-displayed. Populated by _update_cue when the
        # displayed phase changes.
        self._displayed_transitions: List[Dict[str, Any]] = []
        # Countdown state: the last integer second we beeped/rendered,
        # so the bell rings once per "3, 2, 1" rather than every tick.
        self._last_countdown_int: Optional[int] = None
        # Precompute GO phase count and each GO's ordinal for the
        # "Rep N of M" indicator. Works for reps, ramp, sustained,
        # and both cued distractors (MOVE phases count as reps too).
        active_kinds = (protocols.GO, protocols.MOVE)
        self._active_phase_indices: List[int] = [
            i for i, p in enumerate(self.phases) if p.kind in active_kinds]
        self._total_reps = len(self._active_phase_indices)

        self.grab_set()
        self.after(120, self._draw_timeline)
        # Preflight rest check first — refuse to record if a channel
        # is already railing or is a rest-RMS outlier vs its
        # neighbours. Saves the operator from recording a bad
        # session and only noticing at analysis time.
        self.after(150, self._preflight)

    def _measured_rate(self) -> Tuple[int, str]:
        """(rate, how we got it) — the rate the client actually observed.

        Returns the provenance alongside the number so the CSV can say
        which it is. A guessed rate and a measured one must never look
        identical in the archive: the frequency features are computed
        against it, and no later reader can recover the truth from the
        samples alone.
        """
        sps = self.app.client.samples_per_second()
        if sps <= 0:
            return _fallback_fs(), "assumed"
        return int(round(sps / 10.0) * 10), "measured"

    # ------------------------------------------------------------ cueing

    def _draw_timeline(self) -> None:
        """Whole protocol as coloured segments, so what's coming is visible."""
        self.timeline.delete("all")
        width = max(self.timeline.winfo_width(), 400)
        total = self.duration_s or 1.0
        for phase in self.phases:
            x0 = width * phase.start_s / total
            x1 = width * phase.end_s / total
            color = PHASE_COLORS.get(phase.kind, CARD)
            self.timeline.create_rectangle(
                x0, 4, max(x1 - 1, x0 + 1), 24, fill=color, outline="")
        self.playhead = self.timeline.create_line(0, 0, 0, 30, fill=TEXT, width=2)

    def _update_cue(self, elapsed: float) -> None:
        """Render the cue band, phase clock, countdown, and rep counter.

        The band swaps to a solid fill on GO and RELAX so the state is
        readable across a room. Colour + word + fill are all changed
        together — colour alone is unreliable for colour-blind users.

        In the last COUNTDOWN_LEAD_S seconds of any phase whose next
        phase is GO / RELAX / MOVE, the numeral turns large and amber
        and the app rings the bell once per integer second — the
        "3 ... 2 ... 1 ..." into every transition.
        """
        phase = protocols.phase_at(self.phases, elapsed)
        if phase is None:
            return
        nxt = protocols.next_phase(self.phases, elapsed)
        # Compute current rep number if this phase is one of the
        # active cued phases (GO / MOVE), or 0 otherwise.
        cur_rep = 0
        if self._total_reps > 0:
            try:
                idx = self.phases.index(phase)
                if idx in self._active_phase_indices:
                    cur_rep = self._active_phase_indices.index(idx) + 1
            except ValueError:
                cur_rep = 0
        if self._total_reps > 0:
            if cur_rep:
                self.rep_lbl.configure(
                    text=f"Rep {cur_rep} of {self._total_reps}")
            elif nxt is not None and nxt.kind in (protocols.GO, protocols.MOVE):
                # Show "up next" rep number even during PREPARE/RELAX
                try:
                    nxt_idx = self.phases.index(nxt)
                    if nxt_idx in self._active_phase_indices:
                        rep = self._active_phase_indices.index(nxt_idx) + 1
                        self.rep_lbl.configure(
                            text=f"Rep {rep} of {self._total_reps} — up next")
                except ValueError:
                    pass
            else:
                self.rep_lbl.configure(text="")

        # Detect a fresh phase transition.
        if phase is not self._last_phase:
            self._displayed_transitions.append({
                "t_elapsed_s": round(elapsed, 4),
                "kind":  phase.kind,
                "label": phase.label,
            })
            self._last_phase = phase
            self._last_countdown_int = None

            color = PHASE_COLORS.get(phase.kind, PRIMARY)
            # Solid-fill band for GO and RELAX / STILL / MOVE (active
            # states); PREPARE keeps the neutral background.
            solid_fill = phase.kind in (protocols.GO, protocols.RELAX,
                                        protocols.STILL, protocols.MOVE)
            band_bg = color if solid_fill else CARD_ALT
            self.cue_band.configure(bg=band_bg)
            for widget in (self.phase_lbl, self.detail_lbl,
                           self.phase_clock, self.rep_lbl):
                widget.configure(bg=band_bg)
            # Text colour: dark on the coloured GO band; the label
            # itself is a single word so it reads at a glance:
            # "GET READY", "GO", "RELAX", or the distractor cue label.
            if phase.kind == protocols.GO:
                headline = "GO"
                self.phase_lbl.configure(fg="#052e16")
                self.detail_lbl.configure(fg="#052e16")
                self.phase_clock.configure(fg="#052e16")
                self.rep_lbl.configure(fg="#052e16")
                self.bell()   # audible GO cue
            elif phase.kind in (protocols.RELAX, protocols.STILL):
                headline = "RELAX" if phase.kind == protocols.RELAX else "STILL"
                self.phase_lbl.configure(fg="#450a0a")
                self.detail_lbl.configure(fg="#450a0a")
                self.phase_clock.configure(fg="#450a0a")
                self.rep_lbl.configure(fg="#450a0a")
                self.bell()   # audible REST cue
            elif phase.kind == protocols.PREPARE:
                headline = "GET READY"
                self.phase_lbl.configure(fg=PRIMARY)
                self.detail_lbl.configure(fg=TEXT)
                self.phase_clock.configure(fg=TEXT_DIM)
                self.rep_lbl.configure(fg=TEXT_DIM)
            elif phase.kind == protocols.MOVE:
                headline = phase.label     # distractor cue keeps its label
                self.phase_lbl.configure(fg="#4c2a04")
                self.detail_lbl.configure(fg="#4c2a04")
                self.phase_clock.configure(fg="#4c2a04")
                self.rep_lbl.configure(fg="#4c2a04")
                self.bell()
            else:
                headline = phase.label
                self.phase_lbl.configure(fg=color)
                self.detail_lbl.configure(fg=TEXT)
                self.phase_clock.configure(fg=TEXT_DIM)
                self.rep_lbl.configure(fg=TEXT_DIM)
            self.phase_lbl.configure(text=headline)
            self.detail_lbl.configure(text=phase.detail)

        # Countdown numeral. If we're inside the last COUNTDOWN_LEAD_S
        # seconds of THIS phase AND the next phase is one worth
        # counting into, show a big amber integer and beep once per
        # tick. Otherwise show the fractional clock as before.
        remaining = max(phase.end_s - elapsed, 0.0)
        counting_kinds = (protocols.GO, protocols.RELAX, protocols.MOVE)
        show_countdown = (nxt is not None
                          and nxt.kind in counting_kinds
                          and remaining <= COUNTDOWN_LEAD_S
                          and remaining > 0)
        if show_countdown:
            n = max(1, int(math.ceil(remaining)))
            self.phase_clock.configure(
                text=str(n), fg=COUNTDOWN_COLOR,
                font=("Consolas", 80, "bold"))
            if self._last_countdown_int != n:
                self._last_countdown_int = n
                self.bell()
        else:
            self.phase_clock.configure(
                text=f"{remaining:0.1f}",
                font=("Consolas", 30, "bold"))

        self.next_lbl.configure(
            text=f"next: {nxt.label}" if nxt else "last phase — nearly done")

        width = max(self.timeline.winfo_width(), 400)
        x = width * min(elapsed / (self.duration_s or 1.0), 1.0)
        try:
            self.timeline.coords(self.playhead, x, 0, x, 30)
        except tk.TclError:
            pass

    # ------------------------------------------------------------ phases

    # ------------------------------------------------------------ preflight

    def _preflight(self) -> None:
        """3-second rest sample; refuse to record if a channel is bad.

        Runs before opening the writer, so a rejected preflight leaves
        no probe file behind. Two checks:
          1. Any channel clipping >= 0.5% at rest → refuse.
          2. Any channel's RMS > 2.5x median of the others → contact
             fault, refuse and name the channel.
        Both come from the diagnostic in WORKLOG (probe 001 ch2).
        """
        if self._cancelled:
            return
        if not hasattr(self, "_preflight_started_mono"):
            self._preflight_started_mono = time.monotonic()
            self.phase_lbl.configure(text="PREFLIGHT",
                                     fg=WARN, bg=CARD_ALT)
            self.detail_lbl.configure(
                text="Sampling 3 seconds of rest — keep the arm still.",
                fg=TEXT, bg=CARD_ALT)
            self.phase_clock.configure(text="3", fg=WARN, bg=CARD_ALT,
                                       font=("Consolas", 80, "bold"))
            self.rep_lbl.configure(text="", bg=CARD_ALT)
            self.cue_band.configure(bg=CARD_ALT)
        waited = time.monotonic() - self._preflight_started_mono
        remain = max(0.0, 3.0 - waited)
        if remain > 0:
            self.phase_clock.configure(text=str(int(math.ceil(remain))))
            self.after(200, self._preflight)
            return
        # Preflight window done. Check the snapshot.
        window = self.app.client.snapshot(3.0)
        verdict = self._evaluate_preflight(window)
        if verdict["ok"]:
            self.phase_lbl.configure(text="PREFLIGHT OK", fg=SUCCESS)
            self.detail_lbl.configure(text="Starting recording…", fg=TEXT)
            self.phase_clock.configure(text="")
            self.after(400, self._start)
            return
        # Failure: show the reason. Provide Retry / Cancel.
        self.phase_lbl.configure(text="PREFLIGHT FAILED", fg=ERROR)
        self.detail_lbl.configure(text=verdict["message"], fg=ERROR)
        self.phase_clock.configure(text="", fg=TEXT_DIM)
        # Retry / cancel buttons in the cue band.
        if not hasattr(self, "_preflight_retry_row"):
            self._preflight_retry_row = tk.Frame(self.cue_band, bg=CARD_ALT)
            self._preflight_retry_row.pack(pady=(6, 0))
            _button(self._preflight_retry_row, "Retry preflight",
                    self._preflight_retry, bg=ACCENT, fg="#000000").pack(
                    side="left", padx=6)
            _button(self._preflight_retry_row, "Cancel", self._cancel,
                    bg=CARD, fg=ERROR).pack(side="left", padx=6)

    def _preflight_retry(self) -> None:
        # Reset the timer and hide the retry buttons for a fresh check.
        del self._preflight_started_mono
        if hasattr(self, "_preflight_retry_row"):
            self._preflight_retry_row.destroy()
            del self._preflight_retry_row
        self._preflight()

    def _evaluate_preflight(self, window: np.ndarray) -> Dict[str, Any]:
        """Analyse a rest sample. Return {ok: bool, message: str}."""
        if window.shape[1] < 400:
            return {"ok": False,
                    "message": ("No signal yet. Confirm the band is "
                                "connected and streaming, then retry.")}
        ac = window - window.mean(axis=1, keepdims=True)
        rms = np.sqrt((ac * ac).mean(axis=1))
        clipped_pct = 100.0 * np.mean(np.abs(window) >= 0.999, axis=1)
        problems = []
        for ch in range(3):
            if clipped_pct[ch] >= 0.5:
                problems.append(f"ch{ch+1} clipping {clipped_pct[ch]:.1f}% at rest "
                                "— reseat or adjust that electrode")
        # Outlier RMS check — a single-channel contact fault (see
        # probe 001 ch2 investigation in WORKLOG).
        for ch in range(3):
            others = [rms[j] for j in range(3) if j != ch]
            med = float(np.median(others))
            if med > 1e-9 and rms[ch] / med > 2.5:
                problems.append(f"ch{ch+1} rest RMS {rms[ch]:.3f} is "
                                f"{rms[ch]/med:.1f}x the other channels "
                                "— electrode contact fault")
        if problems:
            return {"ok": False,
                    "message": "  •  " + "\n  •  ".join(problems)}
        return {"ok": True, "message": ""}

    # ------------------------------------------------------------ start

    def _start(self) -> None:
        if self._cancelled:
            return
        profile = self.app.profile
        self._path = self.session.new_probe_path(self.probe_name)
        # Structured placement fields from placement_contract, so a
        # reader in five years can reproduce the band position exactly
        # rather than parsing a human-readable string.
        from placement_contract import PLACEMENT_CONVENTION_VERSION
        placement_obj = (profile.placement(self.session.arm)
                         if profile else None)
        limb_obj = (profile.limb(self.session.arm)
                    if profile else None)
        meta = ProbeMeta(
            probe=self.probe_name,
            profile=profile.name if profile else "",
            profile_type=profile.type if profile else "subject",
            arm=self.session.arm,
            session=self.session.stamp,
            kind=self.kind,
            sample_rate_hz=self._rate,
            sample_rate_source=self._rate_source,
            placement=profile.latest_placement(self.session.arm) if profile else "",
            placement_distance_mm=(placement_obj.distance_mm
                                   if placement_obj else None),
            placement_rotation_deg=(placement_obj.rotation_deg
                                    if placement_obj else None),
            placement_convention_version=(PLACEMENT_CONVENTION_VERSION
                                          if placement_obj else None),
            anatomy_source=(limb_obj.measurement_source
                            if limb_obj else ""),
        )
        # Record the protocol in the CSV header so the file explains its
        # own structure to anyone reading it years from now.
        meta.extra["protocol"] = self.protocol_key
        if self.cues:
            meta.extra["cued_attempts"] = len(self.cues)
        # Full intended schedule as a serialised event list.  Every
        # phase becomes an object with start_s/end_s/kind/label.  The
        # `displayed_transitions` list is filled in at close time —
        # what the operator ACTUALLY saw — so a reader can compare
        # the two and know whether the cue timing drifted.
        import json as _json
        meta.extra["schedule_json"] = _json.dumps(
            protocols.phase_events(self.phases))
        try:
            self._writer = ProbeWriter(self._path, meta)
        except OSError as exc:
            messagebox.showerror("Cannot record", f"Could not open the probe "
                                                  f"file for writing:\n{exc}",
                                 parent=self)
            self.destroy()
            return

        self._recording = True
        self._t_started_mono = time.monotonic()
        self._t_started_wall = time.time()
        self._last_total = self.app.client.samples_received
        self.after(0, self._tick)

    def _tick(self) -> None:
        if self._cancelled or not self._recording or self._writer is None:
            return
        self._drain()
        elapsed = time.monotonic() - self._t_started_mono
        self._update_cue(elapsed)
        self.progress.configure(value=min(100.0, elapsed / self.duration_s * 100.0))
        self.samples_var.set(
            f"{self._writer.n_written:,} samples written   "
            f"{elapsed:0.1f}s / {self.duration_s:0.0f}s"
            + (f"   ·   {len(self.cues)} cued attempts" if self.cues else ""))
        if elapsed >= self.duration_s:
            self._finish()
            return
        self.after(50, self._tick)

    def _drain(self) -> None:
        """Move everything new from the client's ring buffer to disk."""
        if self._writer is None:
            return
        total = self.app.client.samples_received
        new = total - self._last_total
        if new <= 0:
            return
        block = self.app.client.tail(new)
        if block.shape[1]:
            self._writer.append(block)
        self._last_total = total
        # Live per-channel clip%, using the last 1 s window from the
        # client. Turns red at >= 1% (visible in the room).
        try:
            win = self.app.client.snapshot(1.0)
            if win.shape[1] > 40:
                import probe_store as _ps
                fracs = _ps.clip_fraction(win)
                for ch, lbl in enumerate(self._clip_ch_labels):
                    pct = 100.0 * float(fracs[ch])
                    if pct >= 1.0:
                        colour = ERROR
                    elif pct >= 0.1:
                        colour = WARN
                    else:
                        colour = SUCCESS
                    lbl.configure(text=f"ch{ch+1} {pct:4.1f}%", fg=colour)
        except Exception:
            pass

    # ------------------------------------------------------------ endings

    def _finish(self) -> None:
        self._recording = False
        self._drain()
        self.cue_band.configure(bg=CARD_ALT)
        for widget in (self.phase_lbl, self.detail_lbl, self.phase_clock):
            widget.configure(bg=CARD_ALT)
        self.phase_lbl.configure(text="Done — saving…", fg=PRIMARY)
        self.detail_lbl.configure(text="", fg=TEXT)
        self.phase_clock.configure(text="", fg=TEXT_DIM)
        self.update_idletasks()
        self._close_writer()

    def _stop_early(self) -> None:
        if not self._recording:
            self._cancel()
            return
        self._recording = False
        self._drain()
        self._close_writer()

    def _close_writer(self) -> None:
        if self._writer is None:
            self.destroy()
            return
        measured = self.app.client.samples_per_second()
        # Phase-vs-sample audit: compare the intended schedule against
        # what was actually displayed, then persist both. This is the
        # "assert on close" step of the authoritative-timeline spec.
        import json as _json
        audit = self._audit_schedule_vs_displayed()
        extra = {
            "displayed_transitions_json": _json.dumps(self._displayed_transitions),
            "schedule_audit_max_lag_ms":  audit["max_lag_ms"],
            "schedule_audit_mismatch_frac": round(audit["mismatch_frac"], 6),
        }
        if measured:
            extra["measured_rate_hz"] = round(measured, 1)
        meta = self._writer.close(**{f"extra_{k}": v for k, v in extra.items()})
        path = self._path
        self._writer = None
        self.destroy()
        self.on_done(path, meta, self.cues, self.protocol_key)

    def _audit_schedule_vs_displayed(self) -> Dict[str, Any]:
        """Compare intended schedule against actually-displayed transitions.

        The renderer only reads elapsed on tick, so each displayed
        transition lags its scheduled instant by at most one tick
        period (currently 50 ms). We compute:
          - max_lag_ms: worst observed displayed-vs-scheduled lag
          - mismatch_frac: fraction of scheduled-transition moments
            where the displayed phase disagrees with the schedule
            (which should always be 0 in normal operation)
        Both are written into the CSV header so a reader knows the
        cue timing was actually correct.
        """
        # Build scheduled transitions (phase-change instants) from
        # the intended schedule. The first phase's start is a
        # transition; every subsequent phase's start is another.
        scheduled = [(p.start_s, p.kind, p.label) for p in self.phases]
        if not scheduled or not self._displayed_transitions:
            return {"max_lag_ms": 0, "mismatch_frac": 0.0}
        max_lag = 0.0
        mismatches = 0
        # For each scheduled transition, find the first displayed
        # transition to the same kind AT OR AFTER that time.
        j = 0
        for sched_t, sched_kind, _ in scheduled:
            # Advance j until we find a matching displayed transition
            while (j < len(self._displayed_transitions)
                   and self._displayed_transitions[j]["t_elapsed_s"] < sched_t - 0.001):
                j += 1
            if j >= len(self._displayed_transitions):
                mismatches += 1
                continue
            disp = self._displayed_transitions[j]
            lag_s = disp["t_elapsed_s"] - sched_t
            max_lag = max(max_lag, lag_s)
            if disp["kind"] != sched_kind:
                mismatches += 1
        return {
            "max_lag_ms": int(round(max_lag * 1000)),
            "mismatch_frac": mismatches / max(len(scheduled), 1),
        }

    def _cancel(self) -> None:
        self._cancelled = True
        self._recording = False
        if self._writer is not None:
            # Keep what he already gave us — it cost him something.
            self._writer.abort("cancelled by operator")
            path, self._writer = self._path, None
            self.destroy()
            self.on_done(path, None, [], self.protocol_key)
            return
        self.destroy()


# ============================================================== rating strip


class RatingStrip(tk.Frame):
    """Rate the probe that was just recorded. Three taps and a note.

    Defaults are pre-selected so "record, record, record" works without
    ever touching this — an unrated probe is still a saved probe.
    """

    def __init__(self, master, app: "App") -> None:
        super().__init__(master, bg=CARD, padx=12, pady=10)
        self.app = app
        self.filename = ""
        self.path = ""
        self.probe = ""

        self.title_var = tk.StringVar(value="")
        tk.Label(self, textvariable=self.title_var, bg=CARD, fg=PRIMARY,
                 font=("Segoe UI Semibold", 11)).grid(row=0, column=0,
                                                      columnspan=4, sticky="w")

        self.effort_var = tk.StringVar(value="moderate")
        self.fatigue_var = tk.StringVar(value="none")
        self.conf_var = tk.IntVar(value=3)

        self._radio_row(1, "How hard was it?", self.effort_var, EFFORTS)
        self._radio_row(2, "Tired him?", self.fatigue_var, FATIGUES)

        tk.Label(self, text="Same every time? (1-5)", bg=CARD, fg=TEXT_DIM,
                 font=("Segoe UI", 9)).grid(row=3, column=0, sticky="w", pady=(6, 0))
        conf_frame = tk.Frame(self, bg=CARD)
        conf_frame.grid(row=3, column=1, columnspan=3, sticky="w", pady=(6, 0))
        for n in range(1, 6):
            tk.Radiobutton(
                conf_frame, text=str(n), value=n, variable=self.conf_var,
                bg=CARD, fg=TEXT, selectcolor=CARD_ALT, activebackground=CARD,
                activeforeground=PRIMARY, relief="flat", bd=0, indicatoron=False,
                padx=12, pady=3, font=("Segoe UI Semibold", 10),
                highlightthickness=0,
            ).pack(side="left", padx=1)

        # Notes get a proper multi-line box with room to write. A
        # single-line field next to a dropdown reads as a search bar,
        # and people do not write observations into search bars.
        notes_frame = tk.Frame(self, bg=CARD)
        notes_frame.grid(row=4, column=0, columnspan=4, sticky="ew", pady=(12, 0))
        notes_frame.columnconfigure(0, weight=1)
        tk.Label(notes_frame, text="Notes — what he said, what you saw",
                 bg=CARD, fg=TEXT_DIM,
                 font=("Segoe UI Semibold", 9)).grid(row=0, column=0, sticky="w")
        tk.Label(notes_frame,
                 text="e.g. \"felt distinct to him\" · \"had to concentrate\" · "
                      "\"band slipped halfway\" · \"said it was the easy one\"",
                 bg=CARD, fg="#475569", font=("Segoe UI", 8)
                 ).grid(row=1, column=0, sticky="w", pady=(0, 4))
        self.notes_text = tk.Text(notes_frame, height=3, bg=CARD_ALT, fg=TEXT,
                                  insertbackground=TEXT, wrap="word",
                                  relief="flat", padx=8, pady=6,
                                  font=("Segoe UI", 10))
        self.notes_text.grid(row=2, column=0, sticky="ew")
        _button(notes_frame, "Save rating", self.save, bg=ACCENT, fg="#000000",
                big=True).grid(row=2, column=1, sticky="ne", padx=(10, 0))
        self.columnconfigure(2, weight=1)

        self.result_var = tk.StringVar(value="")
        tk.Label(self, textvariable=self.result_var, bg=CARD, fg=TEXT_DIM,
                 font=("Segoe UI", 9), anchor="w", justify="left",
                 wraplength=900).grid(row=5, column=0, columnspan=4,
                                      sticky="ew", pady=(8, 0))

        # A second opinion on the recording, asked automatically and
        # answered while he is still in the chair. "The band looks like
        # it slipped" is worth a great deal in the ten seconds before
        # the next probe and nothing at all in the report afterwards.
        #
        # It is packed only once there is something to say, so a machine
        # with no assistant backend never sees an empty box.
        self.opinion = tk.Frame(self, bg=CARD_ALT, padx=10, pady=8)
        self.opinion_var = tk.StringVar(value="")
        tk.Label(self.opinion, text="SECOND OPINION", bg=CARD_ALT, fg=ACCENT,
                 font=("Segoe UI Semibold", 8)).pack(anchor="w")
        tk.Label(self.opinion, textvariable=self.opinion_var, bg=CARD_ALT,
                 fg=TEXT, font=("Segoe UI", 10), anchor="w", justify="left",
                 wraplength=880).pack(anchor="w", fill="x")
        self._opinion_token = 0

    def _radio_row(self, row: int, label: str, var: tk.StringVar,
                   options: Tuple[str, ...]) -> None:
        tk.Label(self, text=label, bg=CARD, fg=TEXT_DIM,
                 font=("Segoe UI", 9)).grid(row=row, column=0, sticky="w", pady=(6, 0))
        frame = tk.Frame(self, bg=CARD)
        frame.grid(row=row, column=1, columnspan=3, sticky="w", pady=(6, 0))
        for opt in options:
            tk.Radiobutton(
                frame, text=opt, value=opt, variable=var,
                bg=CARD, fg=TEXT, selectcolor=CARD_ALT, activebackground=CARD,
                activeforeground=PRIMARY, relief="flat", bd=0, indicatoron=False,
                padx=14, pady=3, font=("Segoe UI Semibold", 10),
                highlightthickness=0,
            ).pack(side="left", padx=1)

    # ------------------------------------------------------------ control

    def show_for(self, path: str, meta: ProbeMeta, metrics: Dict[str, Any]) -> None:
        self.path = path
        self.filename = os.path.basename(path)
        self.probe = meta.probe
        self.title_var.set(f"Rate “{meta.probe}”  —  {self.filename}")
        self.effort_var.set(meta.effort or "moderate")
        self.fatigue_var.set(meta.fatigue or "none")
        self.conf_var.set(meta.his_confidence or 3)
        self.notes_text.delete("1.0", "end")
        self.notes_text.insert("1.0", meta.notes or "")
        self.result_var.set(self._summarise(metrics))
        self.request_opinion()

    # -------------------------------------------------- second opinion

    def request_opinion(self) -> None:
        """Ask the assistant what it makes of the recording just saved.

        Everything about this is best-effort. No backend, no network, a
        refusal, a timeout — all of them end with the panel simply not
        appearing. The app has never needed the assistant to work and
        this must not be the thing that changes that.
        """
        self.opinion.grid_forget()
        self.opinion_var.set("")
        if not CONFIG.get("auto_opinion", True):
            return
        sess = self.app.open_session()
        if sess is None:
            return

        import assistant
        try:
            if not assistant.status().get("available"):
                return
        except Exception:
            return

        self._opinion_token += 1
        token = self._opinion_token
        self.opinion_var.set("Thinking about that recording…")
        self.opinion.grid(row=6, column=0, columnspan=4, sticky="ew",
                          pady=(10, 0))

        prof = self.app.profile
        arm = prof.active_arm if prof else ""

        def work() -> None:
            try:
                import calibrate
                cal = calibrate.load(prof, arm) if prof else None
                result = assistant.quick_opinion(sess, calibration=cal)
            except Exception as exc:                      # never propagate
                result = {"ok": False, "message": str(exc)}
            self.after(0, lambda: self._opinion_ready(token, result))

        threading.Thread(target=work, daemon=True).start()

    def _opinion_ready(self, token: int, result: Dict[str, Any]) -> None:
        # A newer recording has already superseded this question.
        if token != self._opinion_token:
            return
        if not result.get("ok"):
            self.opinion.grid_forget()
            self.opinion_var.set("")
            return
        answer = (result.get("text") or "").strip()
        if not answer:
            self.opinion.grid_forget()
            return
        self.opinion_var.set(answer)

    def _summarise(self, m: Dict[str, Any]) -> str:
        if not m:
            return ""
        # The verdict on the recording comes first — it is the thing
        # that decides whether to keep going or record it again.
        verdict = (m.get("quality") or {})
        prefix = ""
        if verdict.get("verdict") == "unusable":
            prefix = "⚠  " + verdict["headline"] + "  Record it again.\n\n"
        elif verdict.get("verdict") == "suspect":
            prefix = "⚠  " + verdict["headline"] + "\n\n"
        if m.get("kind") in ("rest", "baseline"):
            return prefix + ("Baseline captured. Everything else this session "
                             "is measured against it.")
        if m.get("kind") == "distractor":
            return prefix + ("Everyday-movement sample saved. This is a "
                             "NEGATIVE example — it teaches the detector "
                             "what NOT to fire on.")
        # Cued vs detected is the headline: it says whether the attempts
        # he was asked for actually produced signal.
        if m.get("cued"):
            bits = [f"{m.get('n_reps_with_signal', 0)} of "
                    f"{m.get('n_reps_cued', 0)} cued attempts produced signal"]
        else:
            bits = [f"{m.get('n_reps', 0)} repetition"
                    f"{'s' if m.get('n_reps') != 1 else ''} found"]
        if m.get("consistency") is not None:
            bits.append(f"consistency {m['consistency']:.2f}")
        if m.get("best_channel_db") is not None:
            bits.append(f"{m['best_channel_db']:+.1f} dB above rest "
                        f"on ch{(m.get('best_channel') or 0) + 1}")
        for key in ("cue_note", "consistency_note"):
            if m.get(key):
                bits.append(m[key])
        return prefix + "   ·   ".join(bits)

    def save(self) -> None:
        if not self.filename:
            return
        sess = self.app.open_session()
        if sess is None:
            return
        updates = {
            "effort":         self.effort_var.get(),
            "fatigue":        self.fatigue_var.get(),
            "his_confidence": int(self.conf_var.get()),
            "notes":          self.notes_text.get("1.0", "end").strip(),
        }
        # Rewrite the CSV header so the file stays self-describing, then
        # mirror into the manifest.
        try:
            _rewrite_probe_header(self.path, updates)
        except Exception as exc:
            self.app.flash(f"Could not update the probe header: {exc}")
        sess.update_probe(self.filename, **updates)
        self.app.flash(f"Rated “{self.probe}” — {updates['effort']}, "
                       f"fatigue {updates['fatigue']}, "
                       f"confidence {updates['his_confidence']}/5")
        self.app.session_tab.refresh_library()


def _rewrite_probe_header(path: str, updates: Dict[str, Any]) -> None:
    """Apply late ratings to a finished CSV without touching the data grid."""
    from probe_store import header_lines, _atomic_write

    samples, meta = load_probe(path)
    for k, v in updates.items():
        if hasattr(meta, k):
            setattr(meta, k, v)
    with open(path, "r", encoding="utf-8", newline="") as f:
        lines = f.read().splitlines()
    body_start = next((i for i, l in enumerate(lines) if not l.startswith("#")),
                      len(lines))
    _atomic_write(path, "\n".join(header_lines(meta) + lines[body_start:]) + "\n")


# ============================================================ session tab


class SessionTab(tk.Frame):
    """The Exploration Lab — and in simple mode, the whole app.

    Name it, hit record, rate it, done. Everything else (session
    creation, filenames, baseline prompting, metrics, analysis) happens
    in the background without a click.
    """

    LIB_COLUMNS = (
        ("index",       "#",           40),
        ("probe",       "Probe",       190),
        ("reps",        "Reps",        50),
        ("consistency", "Consistency", 90),
        ("strength",    "vs rest",     80),
        ("effort",      "Effort",      80),
        ("fatigue",     "Fatigue",     70),
        ("confidence",  "His conf.",   70),
        ("usability",   "Usability",   80),
        ("quality",     "Recording",   90),
        ("notes",       "Notes",       320),
    )

    # How each automatic verdict is drawn. Nothing is hidden or struck
    # through — a flagged recording is still a recording, and the colour
    # is only there so the eye can find the ones worth reading about.
    QUALITY_STYLE = {
        "good":     ("good",     "#e2e8f0"),
        "suspect":  ("suspect",  "#fbbf24"),
        "unusable": ("unusable", "#f87171"),
    }

    def __init__(self, master, app: "App") -> None:
        super().__init__(master, bg=BG)
        self.app = app
        self._sort_key: Optional[str] = None
        self._sort_desc = True
        self._rest_cache: Dict[str, Dict[str, Any]] = {}
        self._proto_touched = False

        # ---- pre-flight
        #
        # One line, always visible, answering the only question that
        # matters before anyone sits down: can we record right now? A
        # session with Kyle costs a car journey and twenty minutes of a
        # tiring arm — discovering afterwards that the placement was
        # never recorded, or the disk was full, means the whole thing
        # cannot be compared with anything.
        self.preflight_bar = tk.Frame(self, bg=CARD_ALT, padx=14, pady=8)
        self.preflight_bar.pack(fill="x", pady=(0, 6))
        self.preflight_var = tk.StringVar(value="Checking…")
        self.preflight_lbl = tk.Label(
            self.preflight_bar, textvariable=self.preflight_var, bg=CARD_ALT,
            fg=TEXT, font=("Segoe UI Semibold", 10), anchor="w",
            justify="left", wraplength=880)
        self.preflight_lbl.pack(side="left")
        preflight_more = tk.Label(self.preflight_bar, text="details",
                                  bg=CARD_ALT, fg=ACCENT,
                                  font=("Segoe UI", 9), cursor="hand2")
        preflight_more.pack(side="right")
        # The whole strip is the target, not just the word "details" —
        # anything that says something is wrong should be clickable at
        # the place the eye already is.
        for widget in (self.preflight_bar, self.preflight_lbl, preflight_more):
            widget.bind("<Button-1>", lambda _e: self.show_preflight())
        self._preflight: Dict[str, Any] = {}

        # ---- the guide: goal, what just happened, what to do next
        guide = tk.Frame(self, bg=CARD_ALT, padx=14, pady=12)
        guide.pack(fill="x")

        goalrow = tk.Frame(guide, bg=CARD_ALT)
        goalrow.pack(fill="x")
        tk.Label(goalrow, text="GOAL", bg=CARD_ALT, fg=TEXT_DIM,
                 font=("Segoe UI Semibold", 8)).pack(side="left")
        tk.Label(goalrow, text=coach.GOAL, bg=CARD_ALT, fg=TEXT,
                 font=("Segoe UI", 10)).pack(side="left", padx=(8, 0))
        self.progress_var = tk.StringVar(value="")
        tk.Label(goalrow, textvariable=self.progress_var, bg=CARD_ALT,
                 fg=PRIMARY, font=("Segoe UI Semibold", 10)).pack(side="right")

        # Step pips — six squares, filled as each prerequisite is met.
        self.steps_canvas = tk.Canvas(guide, height=10, bg=CARD_ALT,
                                      highlightthickness=0)
        self.steps_canvas.pack(fill="x", pady=(6, 0))

        self.last_var = tk.StringVar(value="")
        self.last_lbl = tk.Label(guide, textvariable=self.last_var, bg=CARD_ALT,
                                 fg=SUCCESS, font=("Segoe UI", 10), anchor="w",
                                 justify="left", wraplength=1080)
        self.headline_var = tk.StringVar(value="")
        tk.Label(guide, textvariable=self.headline_var, bg=CARD_ALT, fg=PRIMARY,
                 font=("Segoe UI Semibold", 14), anchor="w", justify="left",
                 wraplength=1080).pack(fill="x", pady=(8, 0))
        self.because_var = tk.StringVar(value="")
        tk.Label(guide, textvariable=self.because_var, bg=CARD_ALT, fg=TEXT_DIM,
                 font=("Segoe UI", 10), anchor="w", justify="left",
                 wraplength=1080).pack(fill="x", pady=(2, 0))

        # Ideas for what to try — click one to load it into the name box.
        self.suggest_frame = tk.Frame(guide, bg=CARD_ALT)
        self._suggest_widgets: List[tk.Widget] = []

        # ---- what to do now
        action = tk.Frame(self, bg=CARD, padx=14, pady=12)
        action.pack(fill="x", pady=(8, 0))

        self.cue_var = tk.StringVar(value="")
        tk.Label(action, textvariable=self.cue_var, bg=CARD, fg=TEXT_DIM,
                 font=("Segoe UI", 10), anchor="w",
                 justify="left").grid(row=0, column=0, columnspan=3, sticky="w")

        tk.Label(action, text="What is he trying to do?  (his words)",
                 bg=CARD, fg=TEXT_DIM, font=("Segoe UI", 9)
                 ).grid(row=1, column=0, sticky="w", pady=(10, 2))

        self.name_var = tk.StringVar(value="")
        self.name_box = ttk.Combobox(action, textvariable=self.name_var,
                                     font=("Segoe UI", 13), width=32, values=())
        self.name_box.grid(row=2, column=0, sticky="w")
        self.name_box.bind("<Return>", lambda _e: self.record())

        self.record_btn = _button(action, "●  Record", self.record,
                                  bg=ACCENT, fg="#000000", big=True)
        self.record_btn.grid(row=2, column=1, sticky="w", padx=(12, 0))

        # Protocol picker: what kind of test, and therefore what the
        # person is cued to do. Auto-selected from context, so it can be
        # ignored entirely — but it is the current action, so it stays
        # in the main flow rather than hiding behind Advanced.
        proto_col = tk.Frame(action, bg=CARD)
        proto_col.grid(row=2, column=2, sticky="w", padx=(16, 0))
        self.proto_var = tk.StringVar(value=protocols.get(protocols.DEFAULT_KEY).name)
        self.proto_box = ttk.Combobox(
            proto_col, textvariable=self.proto_var, state="readonly", width=30,
            values=[name for _k, name in protocols.choices()])
        self.proto_box.pack(anchor="w")
        self.proto_box.bind("<<ComboboxSelected>>", self._on_protocol_pick)
        self.dur_hint = tk.Label(proto_col, text="", bg=CARD, fg=TEXT_DIM,
                                 font=("Segoe UI", 9), anchor="w", justify="left",
                                 wraplength=420)
        self.dur_hint.pack(anchor="w", pady=(2, 0))
        action.columnconfigure(2, weight=1)

        # ---- how this test will go
        #
        # The overlay explains each phase as it happens, which is too
        # late: by then the person is mid-countdown with an arm to
        # watch. This says the whole thing beforehand, in order, and it
        # rewrites itself whenever the movement or the protocol changes.
        #
        # Open by default. Someone who already knows the drill closes it
        # once and it stays closed; someone who does not gets told
        # without having to know there was something to click.
        self.walk_open = tk.BooleanVar(value=CONFIG.get("walkthrough_open", True))
        walk = tk.Frame(self, bg=CARD_ALT, padx=14, pady=10)
        walk.pack(fill="x", pady=(8, 0))
        walk_head = tk.Frame(walk, bg=CARD_ALT)
        walk_head.pack(fill="x")
        self.walk_title = tk.Label(walk_head, text="", bg=CARD_ALT, fg=PRIMARY,
                                   font=("Segoe UI Semibold", 10), anchor="w",
                                   justify="left", wraplength=900)
        self.walk_title.pack(side="left")
        self.walk_toggle = tk.Label(walk_head, text="", bg=CARD_ALT, fg=ACCENT,
                                    font=("Segoe UI", 9), cursor="hand2")
        self.walk_toggle.pack(side="right")
        self.walk_toggle.bind("<Button-1>", lambda _e: self._toggle_walkthrough())
        self.walk_body = tk.Frame(walk, bg=CARD_ALT)
        self._walk_widgets: List[tk.Widget] = []

        # ---- rating strip (hidden until something has been recorded)
        self.rating = RatingStrip(self, app)

        # ---- probe library
        lib = tk.Frame(self, bg=BG)
        lib.pack(fill="both", expand=True, pady=(10, 0))
        head = tk.Frame(lib, bg=BG)
        head.pack(fill="x")
        tk.Label(head, text="Probes this session", bg=BG, fg=PRIMARY,
                 font=("Segoe UI Semibold", 11)).pack(side="left")
        self.lib_hint = tk.Label(head, text="", bg=BG, fg=TEXT_DIM,
                                 font=("Segoe UI", 9))
        self.lib_hint.pack(side="left", padx=(10, 0))
        self.scope_var = tk.StringVar(value="session")
        ttk.Combobox(head, textvariable=self.scope_var, width=22, state="readonly",
                     values=("session", "every session, this arm"),
                     ).pack(side="right")
        self.scope_var.trace_add("write", lambda *_: self.refresh_library())

        tree_frame = tk.Frame(lib, bg=CARD_ALT)
        tree_frame.pack(fill="both", expand=True, pady=(4, 0))
        self.tree = ttk.Treeview(tree_frame, show="headings", selectmode="extended",
                                 columns=[c[0] for c in self.LIB_COLUMNS], height=10)
        for key, label, width in self.LIB_COLUMNS:
            self.tree.heading(key, text=label,
                              command=lambda k=key: self._sort_by(k))
            self.tree.column(key, width=width, anchor="w", stretch=(key == "notes"))
        self.tree.pack(side="left", fill="both", expand=True)
        sb = ttk.Scrollbar(tree_frame, orient="vertical", command=self.tree.yview)
        sb.pack(side="right", fill="y")
        self.tree.configure(yscrollcommand=sb.set)
        self.tree.bind("<<TreeviewSelect>>", lambda _e: self._on_select())
        # Right-click to read the evidence behind a row's verdict.
        self.tree.bind("<Button-3>", self._probe_menu)
        self.probe_menu = tk.Menu(self, tearoff=0, bg=CARD, fg=TEXT,
                                  activebackground=ACCENT,
                                  activeforeground="#000000")
        # No "mark this bad" item. Whether a recording is trustworthy is
        # decided from measurements in probe_quality.py, not by asking
        # the person in the room to judge something they cannot see.
        self.probe_menu.add_command(label="Why was this flagged?",
                                    command=self._why_flagged)
        self.probe_menu.add_command(label="Open the file",
                                    command=self._reveal_probe)

        # ---- compare + footer
        self.compare_var = tk.StringVar(
            value="Select two probes to see whether they can be told apart.")
        tk.Label(lib, textvariable=self.compare_var, bg=CARD, fg=TEXT,
                 font=("Segoe UI", 10), anchor="w", justify="left",
                 wraplength=1100, padx=12, pady=8).pack(fill="x", pady=(6, 0))

        footer = tk.Frame(self, bg=BG)
        footer.pack(fill="x", pady=(8, 0))
        _button(footer, "Open session folder", self._open_folder).pack(side="left")
        _button(footer, "Export session (zip)", self._export).pack(side="left", padx=(6, 0))
        _button(footer, "End session & analyse", self._end_session,
                bg=CARD, fg=WARN).pack(side="right")

        self.after(600, self._tick)

    # ------------------------------------------------------------- state

    def _tick(self) -> None:
        try:
            self.refresh_cue()
            self.refresh_guide()
        finally:
            self.after(1000, self._tick)

    def refresh_guide(self) -> None:
        """The panel that says what happened and what to do next."""
        import calibrate

        prof = self.app.profile
        sess = self.app.open_session()
        if prof is None:
            self.headline_var.set("Pick or create a profile to start.")
            self.because_var.set("")
            self.progress_var.set("")
            return

        probes = sess.probes() if sess else []
        history_names = set()
        for other in prof.sessions(prof.active_arm):
            if sess is None or other.stamp != sess.stamp:
                for e in other.probes():
                    if e.get("kind") not in ("rest", "baseline", "distractor"):
                        history_names.add((e.get("probe") or "").strip().lower())

        state = coach.summarise(
            sess, calibrate.load(prof, prof.active_arm),
            live=self.app.client.signal_state() == STATE_LIVE,
            last_entry=probes[-1] if probes else None,
            previous_entry=self._previous_same_kind(probes),
            history_probe_names=history_names,
        )
        self.headline_var.set(state["headline"])
        self.because_var.set(state["because"])
        self.progress_var.set(f"{state['done']} of {state['total']} steps")

        if state["last_result"]:
            self.last_var.set(state["last_result"])
            if not self.last_lbl.winfo_ismapped():
                self.last_lbl.pack(fill="x", pady=(8, 0))
        elif self.last_lbl.winfo_ismapped():
            self.last_lbl.pack_forget()

        self._draw_steps(state["steps"])
        self._draw_suggestions(state.get("suggestions") or [])

    def _draw_suggestions(self, suggestions: List) -> None:
        """Clickable ideas for what to try, when that is the next step."""
        signature = [name for name, _why in suggestions]
        if signature == getattr(self, "_suggest_sig", None):
            return
        self._suggest_sig = signature
        for widget in self._suggest_widgets:
            widget.destroy()
        self._suggest_widgets = []

        if not suggestions:
            self.suggest_frame.pack_forget()
            return
        self.suggest_frame.pack(fill="x", pady=(10, 0))
        label = tk.Label(self.suggest_frame, text="Ideas — click one to load it:",
                         bg=CARD_ALT, fg=TEXT_DIM, font=("Segoe UI", 9))
        label.pack(anchor="w")
        self._suggest_widgets.append(label)
        for name, why in suggestions:
            row = tk.Frame(self.suggest_frame, bg=CARD_ALT)
            row.pack(fill="x", pady=1)
            btn = _button(row, name, lambda n=name: self._use_suggestion(n),
                          bg=CARD, fg=PRIMARY)
            btn.pack(side="left")
            tk.Label(row, text=why, bg=CARD_ALT, fg="#64748b",
                     font=("Segoe UI", 9)).pack(side="left", padx=(8, 0))
            self._suggest_widgets.append(row)

    def _use_suggestion(self, name: str) -> None:
        self.name_var.set(name)
        self.name_box.focus_set()

    def _previous_same_kind(self, probes: List[Dict[str, Any]]):
        """The one before last of the same kind — for "quieter than last time"."""
        if len(probes) < 2:
            return None
        kind = probes[-1].get("kind")
        for entry in reversed(probes[:-1]):
            if entry.get("kind") == kind:
                return entry
        return None

    def _draw_steps(self, steps: List[Dict[str, Any]]) -> None:
        canvas = self.steps_canvas
        canvas.delete("all")
        width = max(canvas.winfo_width(), 400)
        gap = 4
        seg = (width - gap * (len(steps) - 1)) / max(len(steps), 1)
        for i, step in enumerate(steps):
            x0 = i * (seg + gap)
            canvas.create_rectangle(x0, 2, x0 + seg, 10,
                                    fill=ACCENT if step["done"] else "#1f2937",
                                    outline="")

    def _protocol_key(self) -> str:
        return protocols.name_to_key(self.proto_var.get())

    def _on_protocol_pick(self, _evt=None) -> None:
        self._proto_touched = True
        self.refresh_cue()

    def refresh_cue(self) -> None:
        """The single line that tells the helper what happens next."""
        key = self._protocol_key()
        self.dur_hint.configure(
            text=protocols.summarise(
                key,
                movement=self.name_var.get().strip() or "the movement",
                duration_s=self._duration(),
                n_reps=int(CONFIG.get("protocol_reps")),
                hold_s=float(CONFIG.get("protocol_hold_s")),
                relax_s=float(CONFIG.get("protocol_relax_s")),
                prepare_s=float(CONFIG.get("countdown_s")),
            ) + "  ·  saved as you go")

        if self.app.profile is None:
            self.cue_var.set("Pick or create a profile to start.")
            self.record_btn.configure(state="disabled")
            return

        live = self.app.client.signal_state() == STATE_LIVE
        self.record_btn.configure(state="normal" if live else "disabled")

        sess = self.app.open_session()
        needs_rest = CONFIG.get("auto_prompt_rest") and (sess is None or not sess.has_rest())

        if not live:
            self.cue_var.set("Waiting for a signal — see the message above.")
        elif needs_rest:
            self.cue_var.set("Start with a rest recording — everything else is "
                             "measured against it.")
        else:
            self.cue_var.set("Ready. Name the movement in his words, then record.")

        # Pre-fill "rest" ONLY into an empty, unfocused box, and never
        # touch the field again. This runs on a 1s timer: an earlier
        # version also cleared the box when it read "rest", which meant
        # anyone typing r-e-s-t had it deleted out from under them
        # between keystrokes. A background refresh must never edit what
        # someone is typing.
        if (needs_rest and not self.name_var.get().strip()
                and self.focus_get() is not self.name_box):
            self.name_var.set("rest")
        # Same rule for the protocol: pick the sensible one, but stop
        # once the operator has chosen for themselves.
        if needs_rest and not self._proto_touched:
            self.proto_var.set(protocols.get("rest").name)
        elif not needs_rest and not self._proto_touched \
                and self._protocol_key() == "rest":
            self.proto_var.set(protocols.get(protocols.DEFAULT_KEY).name)

        self.record_btn.configure(
            text="●  Record rest" if needs_rest else "●  Record")

        self.refresh_walkthrough()
        self.refresh_preflight()

    # ---------------------------------------------------------- pre-flight

    def refresh_preflight(self) -> None:
        """Re-run the readiness checks. Cheap enough for the 1 s timer."""
        import preflight
        prof = self.app.profile
        try:
            result = preflight.run(
                self.app.client, prof,
                self.app.open_session() if prof else None)
        except Exception as exc:                     # never block the UI
            self.preflight_var.set(f"Could not run the pre-flight check: {exc}")
            return
        self._preflight = result

        colour = {preflight.OK: SUCCESS, preflight.WARN: WARN,
                  preflight.BLOCK: ERROR}[result["verdict"]]
        mark = {preflight.OK: "✓", preflight.WARN: "!",
                preflight.BLOCK: "✕"}[result["verdict"]]
        summary = result["headline"]
        if result["blocking"]:
            summary = f"{result['blocking'][0]['title']} — "\
                      f"{result['blocking'][0]['detail']}"
        self.preflight_var.set(f"{mark}  {summary}")
        self.preflight_lbl.configure(fg=colour)

    def show_preflight(self) -> None:
        import preflight
        if not self._preflight:
            self.refresh_preflight()
        messagebox.showinfo("Ready to record?",
                            preflight.render(self._preflight))

    # ------------------------------------------------- how this test goes

    def _toggle_walkthrough(self) -> None:
        self.walk_open.set(not self.walk_open.get())
        CONFIG.set("walkthrough_open", self.walk_open.get())
        self.refresh_walkthrough()

    def refresh_walkthrough(self) -> None:
        """Rewrite the pre-flight steps for the recording about to happen."""
        key = self._protocol_key()
        name = self.name_var.get().strip()
        self.walk_title.configure(text=coach.walkthrough_headline(key, name))
        self.walk_toggle.configure(
            text="hide the steps" if self.walk_open.get()
            else "show me the steps")

        if not self.walk_open.get():
            self.walk_body.pack_forget()
            return

        signature = (key, name.lower())
        if getattr(self, "_walk_signature", None) == signature \
                and self._walk_widgets:
            self.walk_body.pack(fill="x", pady=(8, 0))
            return
        self._walk_signature = signature

        for widget in self._walk_widgets:
            widget.destroy()
        self._walk_widgets = []

        steps = coach.walkthrough(
            key, name,
            n_reps=int(CONFIG.get("protocol_reps")),
            hold_s=float(CONFIG.get("protocol_hold_s")),
            duration_s=float(self._duration()))
        headings = {"before": "BEFORE YOU PRESS RECORD",
                    "during": "WHILE IT RUNS",
                    "after":  "WHEN IT FINISHES"}
        seen: set = set()
        number = 0
        for step in steps:
            if step["phase"] not in seen:
                seen.add(step["phase"])
                head = tk.Label(self.walk_body, text=headings[step["phase"]],
                                bg=CARD_ALT, fg=TEXT_DIM,
                                font=("Segoe UI Semibold", 8), anchor="w")
                head.pack(fill="x", pady=(8 if seen != {"before"} else 0, 2))
                self._walk_widgets.append(head)
            number += 1
            row = tk.Frame(self.walk_body, bg=CARD_ALT)
            row.pack(fill="x", pady=(0, 3))
            self._walk_widgets.append(row)
            tk.Label(row, text=f"{number}.", bg=CARD_ALT, fg=ACCENT,
                     font=("Segoe UI Semibold", 10), width=3, anchor="nw"
                     ).pack(side="left", anchor="n")
            text = tk.Frame(row, bg=CARD_ALT)
            text.pack(side="left", fill="x", expand=True)
            tk.Label(text, text=step["title"], bg=CARD_ALT, fg=TEXT,
                     font=("Segoe UI Semibold", 10), anchor="w",
                     justify="left", wraplength=980).pack(fill="x")
            tk.Label(text, text=step["detail"], bg=CARD_ALT, fg=TEXT_DIM,
                     font=("Segoe UI", 9), anchor="w", justify="left",
                     wraplength=980).pack(fill="x")

        self.walk_body.pack(fill="x", pady=(8, 0))

    def _duration(self) -> int:
        sess = self.app.open_session()
        needs_rest = sess is None or not sess.has_rest()
        key = "rest_duration_s" if needs_rest else "probe_duration_s"
        return int(CONFIG.get(key))

    def on_context_changed(self) -> None:
        self.rating.pack_forget()
        self.refresh_cue()
        self.refresh_library()
        self._refresh_name_suggestions()

    def _refresh_name_suggestions(self) -> None:
        """Offer names he has used before on this arm — no fixed list, ever."""
        names: List[str] = []
        prof = self.app.profile
        if prof is not None:
            for sess in reversed(prof.sessions(prof.active_arm)):
                for entry in sess.probes():
                    name = (entry.get("probe") or "").strip()
                    if name and not is_rest_name(name) and name not in names:
                        names.append(name)
        self.name_box.configure(values=names[:40])

    # ----------------------------------------------------------- recording

    def record(self) -> None:
        if self.app.profile is None:
            return
        if self.app.client.signal_state() != STATE_LIVE:
            messagebox.showwarning("No signal",
                                   "No live data — check the message at the top "
                                   "of the window, and the Log tab.")
            return

        sess = self.app.session(create=True)
        if sess is None:
            return
        needs_rest = CONFIG.get("auto_prompt_rest") and not sess.has_rest()
        name = self.name_var.get().strip()

        if needs_rest and not is_rest_name(name):
            if not messagebox.askyesno(
                "No baseline yet",
                "This session has no rest recording. Without one there is "
                "nothing to measure this probe against, and it cannot be "
                "compared with other sessions.\n\n"
                "Record it as a movement probe anyway?",
            ):
                self.name_var.set("rest")
                return
        if not name:
            name = "rest" if needs_rest else ""
        if not name:
            messagebox.showinfo("Name it first",
                                "Give the movement a name — his words are best, "
                                "e.g. “curl ring finger” or “the twitchy one”.")
            self.name_box.focus_set()
            return

        key = self._protocol_key()
        proto = protocols.get(key)
        # The protocol decides the kind — a distractor recording is a
        # negative example, not a movement probe, and must never be
        # scored or ranked as if it were an attempt.
        if proto.probe_kind == "rest" or is_rest_name(name):
            kind = "rest"
        elif proto.probe_kind == "distractor":
            kind = "distractor"
        else:
            kind = "probe"

        self.rating.pack_forget()

        # Placement confirmation modal (Item 4 of the implementation
        # queue). Every recording session must confirm placement
        # explicitly rather than silently inheriting whatever was set
        # weeks ago. On confirm we start the recording; on adjust the
        # operator is taken to the Contact & Placement tab and the
        # record button re-arms without recording.
        if not getattr(sess, "_placement_confirmed", False):
            PlacementConfirmDialog(
                self.app, sess,
                on_confirm=lambda: self._start_recording_after_placement(
                    sess, name, kind, key),
                on_adjust=self._jump_to_placement_tab)
            return

        self._start_recording_after_placement(sess, name, kind, key)

    def _start_recording_after_placement(self, sess, name, kind, key):
        self.app._recording_in_progress = True
        RecordingOverlay(self.app, sess, name, kind, self._duration(),
                         self._on_recorded, protocol_key=key)

    def _jump_to_placement_tab(self):
        try:
            self.app.notebook.select(self.app.contact_tab)
        except Exception:
            pass

    def _on_recorded(self, path: str, meta: Optional[ProbeMeta],
                     cues: Optional[List] = None,
                     protocol_key: str = "") -> None:
        self.app._recording_in_progress = False
        sess = self.app.open_session()
        if sess is None or not path or not os.path.exists(path):
            return
        if meta is None:
            # Cancelled — the partial file is kept and filed, not hidden.
            try:
                _, partial = load_probe(path)
                sess.record_probe(partial, path)
            except Exception:
                pass
            self.app.flash("Recording cancelled — the partial file was kept.")
            self.refresh_library()
            return

        metrics = self._analyse_one(sess, path, meta, cues)
        sess.record_probe(meta, path, metrics=metrics)
        sess.update_probe(os.path.basename(path),
                          quality=metrics.get("quality"))
        # Hash the probe the moment it is finalised — from here on any
        # change to it is detectable.
        try:
            import integrity
            self.app.profile.log(
                f"probe recorded: {meta.probe} ({meta.n_samples} samples)",
                action="probe.record", file=os.path.basename(path),
                kind=meta.kind, samples=meta.n_samples,
                sha256=integrity.sha256_file(path))
        except Exception:
            pass
        sess.update_probe(os.path.basename(path), cues=cues or [],
                          protocol=protocol_key or self._protocol_key())
        if meta.kind == "rest":
            self._rest_cache.pop(sess.stamp, None)   # baseline changed

        self.name_var.set("")
        self.refresh_cue()
        self.refresh_library()
        self._refresh_name_suggestions()
        self.rating.show_for(path, meta, metrics)
        self.rating.pack(fill="x", pady=(10, 0))
        # Post-recording notes dialog — auto-appears after every probe.
        # Non-blocking: opening this does NOT prevent the operator
        # starting the next recording. Ctrl+Enter saves; Skip / Discard
        # / Escape all close without blocking.
        PostRecordingNotesDialog(self.app, sess, path, meta,
                                 on_saved=self.refresh_library)

    def _analyse_one(self, sess: Session, path: str, meta: ProbeMeta,
                     cues: Optional[List] = None) -> Dict[str, Any]:
        """Immediate feedback for the probe just recorded, plus a verdict
        on whether the recording itself was any good."""
        import probe_quality
        from analysis import probe_metrics, usability_score
        try:
            samples, _ = load_probe(path)
            rest = self._rest_for(sess)
            m = probe_metrics(samples, meta.sample_rate_hz or _fallback_fs(), rest,
                              kind=meta.kind, cues=cues)
            features = m.pop("_features", None)
            if features is not None and features.shape[0]:
                # Kept so later recordings of the same movement can be
                # compared against this one.
                m["feature_mean"] = [round(float(v), 6)
                                     for v in features.mean(axis=0)]
            m.update(usability_score(m, meta.effort, meta.fatigue,
                                     meta.his_confidence))
            siblings = [e for e in sess.probes()
                        if (e.get("probe") or "").strip().lower()
                        == (meta.probe or "").strip().lower()
                        and e.get("file") != os.path.basename(path)]
            m["quality"] = probe_quality.assess_probe(
                samples, meta.sample_rate_hz or _fallback_fs(), m,
                {"metrics": m,
                 "sample_rate_source": meta.sample_rate_source},
                meta.kind, rest, siblings)
            return m
        except Exception as exc:
            return {"error": str(exc)}

    def _rest_for(self, sess: Session) -> Dict[str, Any]:
        if sess.stamp in self._rest_cache:
            return self._rest_cache[sess.stamp]
        from analysis import rest_stats
        rest: Dict[str, Any] = {"available": False}
        entry = sess.rest_probe()
        if entry:
            try:
                samples, meta = load_probe(sess.probe_path(entry["file"]))
                rest = rest_stats(samples, meta.sample_rate_hz or _fallback_fs())
            except Exception:
                pass
        self._rest_cache[sess.stamp] = rest
        return rest

    # ------------------------------------------------------------- library

    def _rows(self) -> List[Tuple[Session, Dict[str, Any]]]:
        prof = self.app.profile
        if prof is None:
            return []
        if self.scope_var.get().startswith("every"):
            sessions = prof.sessions(prof.active_arm)
        else:
            sess = self.app.open_session()
            sessions = [sess] if sess else []
        rows: List[Tuple[Session, Dict[str, Any]]] = []
        for sess in sessions:
            for entry in sess.probes():
                rows.append((sess, entry))
        return rows

    def refresh_library(self) -> None:
        rows = self._rows()
        self.tree.delete(*self.tree.get_children())
        for sess, entry in rows:
            m = entry.get("metrics") or {}
            iid = f"{sess.stamp}|{entry.get('file', '')}"
            probe = entry.get("probe", "")
            if entry.get("kind") in ("rest", "baseline") or is_rest_name(probe):
                probe = f"{probe}  (baseline)"
            elif entry.get("kind") == "distractor":
                probe = f"{probe}  (everyday movement)"
            if self.scope_var.get().startswith("every"):
                probe = f"{probe}   ·   {sess.stamp}"
            quality = entry.get("quality") or m.get("quality") or {}
            verdict = quality.get("verdict", "")
            tag, _colour = self.QUALITY_STYLE.get(verdict, ("", ""))
            # The headline from the quality check is more useful than an
            # empty notes cell, so it fills in when there is no note.
            notes = entry.get("notes") or quality.get("headline", "")
            self.tree.insert(
                "", "end", iid=iid,
                values=(
                    entry.get("index", ""),
                    probe,
                    m.get("n_reps", "—") if entry.get("kind") == "probe" else "—",
                    _fmt(m.get("consistency")),
                    _fmt_db(m.get("best_channel_db")),
                    entry.get("effort") or "—",
                    entry.get("fatigue") or "—",
                    entry.get("his_confidence") or "—",
                    _fmt(m.get("usability")),
                    verdict or "—",
                    notes,
                ),
                tags=(tag,) if tag else (),
            )
        for tag, colour in self.QUALITY_STYLE.values():
            self.tree.tag_configure(tag, foreground=colour)
        if self._sort_key:
            self._apply_sort()

        n_probes = sum(1 for _s, e in rows if e.get("kind") not in ("rest", "baseline"))
        flagged = sum(1 for _s, e in rows
                      if ((e.get("quality") or (e.get("metrics") or {}).get("quality")
                           or {}).get("verdict") in ("suspect", "unusable")))
        hint = f"{n_probes} movement probe{'s' if n_probes != 1 else ''}"
        if n_probes > 1:
            hint += "   ·   click a heading to sort"
        if flagged:
            hint += (f"   ·   {flagged} flagged — right-click to see why "
                     f"(nothing is discarded)")
        self.lib_hint.configure(text=hint)

    # -------------------------------------------- recording quality

    def _selected_probe(self) -> Optional[Tuple[Any, str]]:
        """(session, filename) for the highlighted row."""
        sel = self.tree.selection()
        prof = self.app.profile
        if not sel or prof is None:
            return None
        stamp, filename = sel[0].split("|", 1)
        return prof.get_session(prof.active_arm, stamp), filename

    def _probe_menu(self, event) -> None:
        row = self.tree.identify_row(event.y)
        if row:
            self.tree.selection_set(row)
            self.probe_menu.tk_popup(event.x_root, event.y_root)

    def _why_flagged(self) -> None:
        """Show the evidence behind the automatic verdict."""
        target = self._selected_probe()
        if target is None:
            return
        session, filename = target
        entry = next((e for e in session.probes() if e.get("file") == filename),
                     None)
        quality = ((entry or {}).get("quality")
                   or ((entry or {}).get("metrics") or {}).get("quality") or {})
        if not quality:
            messagebox.showinfo(
                "Recording quality",
                f"{filename}\n\nNo automatic assessment stored for this one — "
                f"it was recorded before the check existed. It will be "
                f"assessed the next time the session is analysed.")
            return
        lines = [filename, "",
                 f"Verdict: {quality.get('verdict', '?')}  "
                 f"(confidence {quality.get('score', 0):.2f})",
                 quality.get("headline", ""), ""]
        if quality.get("flags"):
            lines.append("What was measured:")
            for flag in quality["flags"]:
                lines.append(f"\n· {flag['message']}")
                lines.append(f"  → {flag['fix']}")
        else:
            lines.append("Nothing was flagged.")
        lines.append("")
        lines.append("Nothing is ever discarded — a flagged recording is "
                     "still analysed, and any conclusion resting on it says "
                     "so.")
        messagebox.showinfo("Recording quality", "\n".join(lines))

    def _reveal_probe(self) -> None:
        target = self._selected_probe()
        if target is not None:
            _reveal(target[0].probe_path(target[1]))

    def _sort_by(self, key: str) -> None:
        if self._sort_key == key:
            self._sort_desc = not self._sort_desc
        else:
            self._sort_key, self._sort_desc = key, True
        self._apply_sort()

    def _apply_sort(self) -> None:
        def sort_value(iid: str):
            raw = self.tree.set(iid, self._sort_key)
            try:
                return (0, float(str(raw).replace("dB", "").replace("+", "").strip()))
            except ValueError:
                return (1, str(raw).lower())

        for pos, iid in enumerate(sorted(self.tree.get_children(""),
                                         key=sort_value, reverse=self._sort_desc)):
            self.tree.move(iid, "", pos)
        for key, label, _w in self.LIB_COLUMNS:
            arrow = ""
            if key == self._sort_key:
                arrow = "  ▾" if self._sort_desc else "  ▴"
            self.tree.heading(key, text=label + arrow)

    # --------------------------------------------------------- comparison

    def _on_select(self) -> None:
        sel = self.tree.selection()
        if len(sel) != 2:
            self.compare_var.set(
                "Select two probes to see whether they can be told apart."
                if len(sel) < 2 else
                "Select exactly two probes to compare.")
            return
        try:
            self.compare_var.set(self._compare(sel[0], sel[1]))
        except Exception as exc:
            self.compare_var.set(f"Could not compare these two: {exc}")

    def _compare(self, iid_a: str, iid_b: str) -> str:
        from analysis import feature_windows, find_reps, separability

        prof = self.app.profile
        if prof is None:
            return ""
        clouds, names = [], []
        for iid in (iid_a, iid_b):
            stamp, filename = iid.split("|", 1)
            sess = prof.get_session(prof.active_arm, stamp)
            samples, meta = load_probe(sess.probe_path(filename))
            if meta.kind in ("rest", "baseline"):
                return ("One of those is the baseline recording. Compare two "
                        "movement probes instead.")
            fs = meta.sample_rate_hz or _fallback_fs()
            reps = find_reps(samples, fs, self._rest_for(sess))
            vecs, times = feature_windows(samples, fs)
            if reps and vecs.shape[0]:
                keep = np.zeros(vecs.shape[0], dtype=bool)
                for a, b in reps:
                    keep |= (times >= a - 0.25) & (times <= b)
                vecs = vecs[keep] if keep.any() else vecs
            clouds.append(vecs)
            names.append(meta.probe)

        result = separability(clouds[0], clouds[1])
        d = result.get("d_prime")
        if d is None:
            return (f"“{names[0]}” vs “{names[1]}”: not enough activity to "
                    f"compare ({result.get('note', 'no reason given')}).")
        err = result.get("expected_error", 0.0) * 100
        if d < 1.0:
            verdict = ("These are the SAME INPUT as far as a classifier is "
                       "concerned. Two strong probes that look identical are "
                       "one input, not two — change one of them.")
        elif d < 1.5:
            verdict = ("Borderline. A classifier will confuse them some of the "
                       "time. Worth making one of them more distinct.")
        elif d < 3.0:
            verdict = "Usably distinct. Both can be separate inputs."
        else:
            verdict = "Unmistakable. These are clearly different signals."
        return (f"“{names[0]}” vs “{names[1]}”:  d' = {d:.2f},  expected "
                f"confusion {err:.0f}%.  {verdict}")

    # ---------------------------------------------------------- footer

    def _open_folder(self) -> None:
        sess = self.app.open_session() or self._last_session()
        if sess is None:
            messagebox.showinfo("No session yet",
                                "Record something and the folder appears.")
            return
        _reveal(sess.root)

    def _export(self) -> None:
        sess = self.app.open_session() or self._last_session()
        if sess is None:
            messagebox.showinfo("Nothing to export", "No session yet.")
            return
        dest = filedialog.askdirectory(title="Where should the zip go?",
                                       parent=self)
        if not dest:
            return
        try:
            out = sess.export_zip(dest)
        except Exception as exc:
            messagebox.showerror("Export failed", str(exc))
            return
        self.app.flash(f"Exported {os.path.basename(out)} "
                       f"({os.path.getsize(out) / 1_048_576:.1f} MB)")
        _reveal(os.path.dirname(out))

    def _last_session(self) -> Optional[Session]:
        prof = self.app.profile
        if prof is None:
            return None
        sessions = prof.sessions(prof.active_arm)
        return sessions[-1] if sessions else None

    def _end_session(self) -> None:
        prof = self.app.profile
        sess = self.app.open_session()
        if prof is None or sess is None:
            messagebox.showinfo("No open session", "There is no session to end.")
            return
        if not messagebox.askyesno(
            "End session?",
            f"Close {sess.stamp} and analyse it?\n\n"
            f"The report is written automatically — you do not need to do "
            f"anything else.",
        ):
            return
        self.app.close_session_with_progress(prof.active_arm)


# =============================================================== trigger tab


class TriggerTab(tk.Frame):
    """Live detection — the part that does real work.

    Everything else in the app produces data about signals. This turns a
    signal into an action. It is also the one screen that can affect the
    machine outside Factum, so it defaults to dry run, requires an
    explicit arm, and shows exactly what it is about to do.
    """

    def __init__(self, master, app: "App") -> None:
        super().__init__(master, bg=BG)
        self.app = app
        self.detector = None
        self.router = None
        self._last_total = 0
        self._explain = ""

        # ---- status strip
        top = tk.Frame(self, bg=CARD, padx=14, pady=12)
        top.pack(fill="x")
        tk.Label(top, text="Live trigger", bg=CARD, fg=PRIMARY,
                 font=("Segoe UI Semibold", 13)).pack(side="left")
        self.model_var = tk.StringVar(value="")
        tk.Label(top, textvariable=self.model_var, bg=CARD, fg=TEXT_DIM,
                 font=("Segoe UI", 9), anchor="w", justify="left",
                 wraplength=680).pack(side="left", padx=(14, 0))
        _button(top, "Train / retrain", self._train, bg=ACCENT,
                fg="#000000").pack(side="right")

        # ---- the big live readout
        live = tk.Frame(self, bg=CARD_ALT, padx=14, pady=16)
        live.pack(fill="x", pady=(8, 0))
        self.state_lbl = tk.Label(live, text="—", bg=CARD_ALT, fg=TEXT_DIM,
                                  font=("Segoe UI Semibold", 30))
        self.state_lbl.pack()
        self.conf_lbl = tk.Label(live, text="", bg=CARD_ALT, fg=TEXT_DIM,
                                 font=("Consolas", 11))
        self.conf_lbl.pack(pady=(4, 8))
        # Progress-to-fire: "hold it, you're nearly there" beats a dead screen.
        self.hold_canvas = tk.Canvas(live, height=16, bg=CARD_ALT,
                                     highlightthickness=0)
        self.hold_canvas.pack(fill="x")
        tk.Label(live, text="how close the current contraction is to firing",
                 bg=CARD_ALT, fg="#475569",
                 font=("Segoe UI", 8)).pack(anchor="w", pady=(2, 0))

        # ---- output controls
        out = tk.Frame(self, bg=CARD, padx=14, pady=12)
        out.pack(fill="x", pady=(8, 0))
        tk.Label(out, text="What a detection does", bg=CARD, fg=TEXT_DIM,
                 font=("Segoe UI Semibold", 9)).grid(row=0, column=0, sticky="w")
        self.sink_var = tk.StringVar(value="Dry run (no clicking)")
        self.sink_box = ttk.Combobox(out, textvariable=self.sink_var,
                                     state="readonly", width=34, values=())
        self.sink_box.grid(row=1, column=0, sticky="w", pady=(4, 0))
        self.sink_box.bind("<<ComboboxSelected>>", lambda _e: self._set_sink())

        self.arm_btn = _button(out, "ARM", self._toggle_arm, bg=CARD_ALT,
                               fg=WARN, big=True)
        self.arm_btn.grid(row=1, column=1, sticky="w", padx=(14, 0))
        self.arm_var = tk.StringVar(value="")
        tk.Label(out, textvariable=self.arm_var, bg=CARD, fg=TEXT_DIM,
                 font=("Segoe UI", 9), anchor="w", justify="left",
                 wraplength=560).grid(row=1, column=2, sticky="w", padx=(14, 0))
        out.columnconfigure(2, weight=1)
        tk.Label(out, text="Dry run is the default and never touches the mouse. "
                           "A real output must be armed deliberately, disarms "
                           "itself after 5 minutes, and Esc stops it instantly.",
                 bg=CARD, fg="#475569", font=("Segoe UI", 8), anchor="w",
                 justify="left", wraplength=1000
                 ).grid(row=2, column=0, columnspan=3, sticky="w", pady=(8, 0))

        # ---- self-test + log
        bottom = tk.Frame(self, bg=BG)
        bottom.pack(fill="both", expand=True, pady=(8, 0))
        bottom.columnconfigure(0, weight=1, uniform="t")
        bottom.columnconfigure(1, weight=1, uniform="t")
        bottom.rowconfigure(1, weight=1)

        head_l = tk.Frame(bottom, bg=BG)
        head_l.grid(row=0, column=0, sticky="ew")
        tk.Label(head_l, text="Self-test against recordings", bg=BG, fg=PRIMARY,
                 font=("Segoe UI Semibold", 11)).pack(side="left")
        _button(head_l, "Run", self._self_test).pack(side="right")
        self.test_text = tk.Text(bottom, bg=CARD, fg=TEXT, wrap="word",
                                 relief="flat", padx=12, pady=10,
                                 font=("Consolas", 9), height=10)
        self.test_text.grid(row=1, column=0, sticky="nsew", padx=(0, 6), pady=(4, 0))
        self.test_text.configure(state="disabled")

        head_r = tk.Frame(bottom, bg=BG)
        head_r.grid(row=0, column=1, sticky="ew")
        tk.Label(head_r, text="Output log", bg=BG, fg=PRIMARY,
                 font=("Segoe UI Semibold", 11)).pack(side="left")
        _button(head_r, "Everyday mode…", self._everyday).pack(side="right")
        _button(head_r, "Inputs & plan", self._show_plan).pack(side="right",
                                                               padx=(0, 6))
        self.log_text = tk.Text(bottom, bg=CARD, fg=TEXT, wrap="none",
                                relief="flat", padx=12, pady=10,
                                font=("Consolas", 9), height=10)
        self.log_text.grid(row=1, column=1, sticky="nsew", padx=(6, 0), pady=(4, 0))
        self.log_text.configure(state="disabled")

        self.after(600, self._tick)

    # ------------------------------------------------------------- setup

    def _ensure(self) -> None:
        import detector as detector_mod
        import output

        if self.router is None:
            self.router = output.OutputRouter()
            self.sink_box.configure(
                values=[s.name for s in output.SINKS.values() if s.available()
                        or not s.is_real])
        if self.detector is None and self.app.profile is not None:
            # Motion-score provider: IMU + sub-20 Hz SNC. When motion
            # is high the detector abstains instead of firing. This
            # is the primary false-fire mitigation per STATUS.md and
            # WORKLOG — was built but not wired until now.
            def _motion() -> float:
                try:
                    return float(self.app.client.motion_score(0.25))
                except Exception:
                    return 0.0
            det, note = detector_mod.from_profile(
                self.app.profile, self.app.profile.active_arm,
                sample_rate_hz=int(self.app.client.samples_per_second() or _fallback_fs()),
                on_fire=self._on_fire,
                motion_score_provider=_motion)
            self.detector = det
            self._explain = note
            self.model_var.set(note)

    def reload_model(self) -> None:
        self.detector = None
        self._ensure()

    # ------------------------------------------------------------ actions

    def _train(self) -> None:
        """Try several configurations, keep the best, archive it, and say
        whether more data would help."""
        import training

        prof = self.app.profile
        if prof is None:
            return
        arm = prof.active_arm
        sessions = [s for s in prof.sessions(arm) if s.probes()]
        if not sessions:
            messagebox.showinfo("Nothing to train on",
                                "Record a rest baseline, a movement, and an "
                                "everyday-movement sample first.")
            return

        self.model_var.set("Training — trying several configurations…")
        self.update_idletasks()
        try:
            result = training.train_and_register(
                prof, arm, sessions[-1], extra_sessions=sessions[:-1])
        except Exception as exc:
            messagebox.showerror("Training failed", str(exc))
            self.reload_model()
            return
        if not result.get("ok"):
            messagebox.showinfo("Cannot train yet", result.get("reason", ""))
            self.reload_model()
            return

        self.reload_model()
        entry = result["entry"]
        best = result["selection"]["best"]
        lines = [
            f"Model v{entry['version']} — tried "
            f"{len(result['selection']['tried'])} configurations, kept the "
            f"best ({best['feature_version']}, shrinkage {best['shrinkage']}).",
            f"Catches {(entry.get('recall_at_operating_point') or 0)*100:.0f}% "
            f"of attempts at "
            f"{(entry.get('false_fire_rate') or 0)*100:.2f}% false fires per "
            f"window, held for {entry.get('hold_time_s')}s.",
        ]
        if entry.get("change"):
            change = entry["change"]
            direction = ("REGRESSION vs " if entry.get("regression")
                         else "vs ")
            lines.append(f"{direction}v{change['vs_version']}: recall "
                         f"{change['recall']:+.0%}, false fires "
                         f"{change['false_fire']:+.2%}."
                         + (" The previous model can be restored from the "
                            "Tuning tab." if entry.get("regression") else ""))
        curve = result.get("curve", {})
        if curve.get("available"):
            lines.append(curve["verdict"])
        messagebox.showinfo("Model trained", "\n\n".join(lines))
        self._self_test()

    def _set_sink(self) -> None:
        import output
        self._ensure()
        for key, sink in output.SINKS.items():
            if sink.name == self.sink_var.get():
                self.router.set_sink(key)
                if sink.is_real:
                    self.app.flash(f"Output set to {sink.name} — still "
                                   f"disarmed. Press ARM to enable it.")
                break

    def _toggle_arm(self) -> None:
        self._ensure()
        if self.router.armed:
            self.router.disarm()
            return
        if not self.router.sink.is_real:
            self.app.flash("Dry run needs no arming — it never touches the "
                           "mouse. Choose a real output first.")
            return
        if not messagebox.askyesno(
            "Arm live output?",
            f"This will let detected signals actually trigger:\n\n"
            f"    {self.router.sink.name}\n\n"
            f"It affects whatever is under the cursor. It disarms itself "
            f"after 5 minutes, and Esc disarms it immediately.\n\nArm it?",
        ):
            return
        self.router.arm()

    def _on_fire(self, label: str, confidence: float) -> None:
        if self.router is not None:
            self.router.emit(label, confidence)

    def panic(self) -> None:
        if self.router is not None and self.router.armed:
            self.router.disarm("Esc pressed")
            self.app.flash("Output DISARMED.")

    def _self_test(self) -> None:
        """Replay recordings through the detector and count false fires."""
        import os as _os

        from probe_store import load_probe
        self._ensure()
        prof = self.app.profile
        if prof is None or self.detector is None:
            self._set_test("No model yet — train one first.")
            return
        arm = prof.active_arm
        sessions = [s for s in prof.sessions(arm) if s.probes()]
        if not sessions:
            self._set_test("No recordings to test against.")
            return

        lines = ["Replaying recordings through the live detector.",
                 "Rest and everyday movement MUST produce zero fires.", ""]
        false_fires = 0
        for sess in sessions[-3:]:
            for entry in sess.probes():
                path = sess.probe_path(entry["file"])
                if not _os.path.exists(path):
                    continue
                try:
                    samples, meta = load_probe(path)
                except Exception:
                    continue
                self.detector.configure(
                    self.detector.model, meta.sample_rate_hz or _fallback_fs(),
                    self.detector.confidence_threshold,
                    self.detector.hold_windows, self.detector.refractory_s)
                res = self.detector.evaluate_recording(
                    samples, meta.sample_rate_hz or _fallback_fs())
                if not res.get("available"):
                    continue
                reject = meta.kind in ("rest", "baseline", "distractor")
                mark = ""
                if reject:
                    mark = "  <-- FALSE FIRE" if res["fires"] else "  ok"
                    false_fires += res["fires"]
                lines.append(f"{(meta.probe or '?')[:30]:30} [{meta.kind:10}] "
                             f"{res['fires']:2} fires / {res['duration_s']:5.1f}s{mark}")
        lines.append("")
        lines.append(f"TOTAL FALSE FIRES: {false_fires}")
        if false_fires == 0:
            lines.append("No false fires on any rest or everyday-movement "
                         "recording. That is the bar this has to clear.")
        else:
            lines.append("This would misfire during ordinary use. Do not arm "
                         "a real output — record more everyday-movement "
                         "samples and retrain.")
        self._set_test("\n".join(lines))

    def _show_plan(self) -> None:
        """How many usable inputs exist, and what to record next."""
        import calibrate
        import vocabulary

        prof = self.app.profile
        if prof is None:
            return
        arm = prof.active_arm
        assessment = vocabulary.assess(prof, arm, calibrate.load(prof, arm))
        lines = vocabulary.summary_lines(assessment)
        lines.append("")
        lines.append("-" * 60)
        lines.append(vocabulary.CURSOR_NOTE)
        self._set_test("\n".join(lines))

    def _everyday(self) -> None:
        """Install or remove the login shortcut for everyday-use mode."""
        import everyday

        if everyday.is_installed():
            if not messagebox.askyesno(
                "Everyday mode",
                "Factum currently starts automatically at login in everyday "
                "mode.\n\nStop it starting automatically?",
            ):
                return
            result = everyday.remove_startup()
        else:
            if not messagebox.askyesno(
                "Everyday mode",
                "Start Factum automatically at login?\n\n"
                "It opens a small always-on-top panel instead of this window, "
                "brings up the Mudra host if it is not running, and loads the "
                "last profile and model.\n\n"
                "It still starts DISARMED — arming output stays a deliberate "
                "action every time.",
            ):
                return
            result = everyday.install_startup()
        (messagebox.showinfo if result.get("ok") else messagebox.showerror)(
            "Everyday mode", result.get("message", ""))

    def _set_test(self, text: str) -> None:
        self.test_text.configure(state="normal")
        self.test_text.delete("1.0", "end")
        self.test_text.insert("1.0", text)
        self.test_text.configure(state="disabled")

    # -------------------------------------------------------------- tick

    def _tick(self) -> None:
        try:
            self._ensure()
            # Always pump samples through the detector — even when the
            # Tuning tab is not the visible one. The header-bar click
            # chip reflects live detector state from any tab, so it
            # must actually be scanning in the background. Rendering
            # our own widgets still only runs when we're mapped
            # (cheaper, and avoids flickering hidden widgets).
            self._pump()
            if self.winfo_ismapped():
                self._render()
        except Exception:
            pass
        self.after(100, self._tick)

    def _pump(self) -> None:
        """Feed the detector whatever arrived since the last tick."""
        if self.detector is None:
            return
        total = self.app.client.samples_received
        new = total - self._last_total
        self._last_total = total
        if new <= 0:
            return
        if new > self.app.client.buffer_len:
            new = self.app.client.buffer_len
        block = self.app.client.tail(new)
        if block.shape[1]:
            self.detector.feed(block)

    def _render(self) -> None:
        if self.detector is None:
            self.state_lbl.configure(text="No model", fg=TEXT_DIM)
            self.conf_lbl.configure(text="")
            self.model_var.set(self._explain or "Train a model to start.")
        else:
            snap = self.detector.snapshot()
            if snap["is_signal"] and snap["above_threshold"]:
                color, text = SUCCESS, snap["label"]
            elif snap["label"] == "movement":
                color, text = WARN, "everyday movement"
            elif snap["label"] == "rest":
                color, text = "#3b82f6", "at rest"
            else:
                color, text = TEXT_DIM, snap["label"]
            self.state_lbl.configure(text=text, fg=color)
            self.conf_lbl.configure(
                text=f"confidence {snap['confidence']:.2f}  "
                     f"(fires above {snap['threshold']:.2f})   ·   "
                     f"{snap['consecutive']}/{snap['hold_windows']} windows held"
                     f"   ·   {snap['fires']} detections")
            self._draw_hold(snap["progress"], color)

        if self.router is not None:
            stats = self.router.stats()
            if stats["armed"]:
                self.arm_btn.configure(text="DISARM", bg=ERROR, fg="#ffffff")
                self.arm_var.set(f"ARMED — {stats['sink']} — disarms in "
                                 f"{stats['arm_remaining_s']:.0f}s (Esc stops it)")
            else:
                self.arm_btn.configure(text="ARM", bg=CARD_ALT,
                                       fg=TEXT_DIM if not self.router.sink.is_real else WARN)
                self.arm_var.set("Dry run — nothing is sent."
                                 if not self.router.sink.is_real else
                                 "Not armed. Detections are logged but nothing "
                                 "is sent.")
            self._render_log()

    def _draw_hold(self, progress: float, color: str) -> None:
        canvas = self.hold_canvas
        canvas.delete("all")
        width = max(canvas.winfo_width(), 200)
        canvas.create_rectangle(0, 4, width, 14, fill="#1f2937", outline="")
        if progress > 0:
            canvas.create_rectangle(0, 4, int(width * progress), 14,
                                    fill=color, outline="")

    def _render_log(self) -> None:
        entries = self.router.log[-40:]
        self.log_text.configure(state="normal")
        self.log_text.delete("1.0", "end")
        for e in entries:
            self.log_text.insert("end", f"{e['time']}  {e['kind']:11} "
                                        f"{e['message']}\n")
        self.log_text.configure(state="disabled")
        self.log_text.see("end")


# ============================================================== mini window


class MiniWindow(tk.Toplevel):
    """The everyday-use panel: one small always-on-top status light.

    Sized and coloured to be read from across a room by someone who
    cannot open a log or a menu. It shows what the app is doing and
    nothing else — the full window is one click away for whoever is
    helping.
    """

    LEVEL_COLORS = {
        "waiting":  WARN,
        "ready":    "#3b82f6",
        "movement": WARN,
        "signal":   SUCCESS,
    }

    def __init__(self, app: "App") -> None:
        super().__init__(app)
        self.app = app
        self.title("Factum")
        self.configure(bg=BG)
        self.resizable(False, False)
        try:
            self.attributes("-topmost", True)
        except tk.TclError:
            pass
        # Bottom-right, clear of the taskbar.
        width, height = 320, 168
        x = self.winfo_screenwidth() - width - 24
        y = self.winfo_screenheight() - height - 72
        self.geometry(f"{width}x{height}+{x}+{y}")
        self.protocol("WM_DELETE_WINDOW", self._hide)

        self.band = tk.Frame(self, bg=CARD_ALT, height=8)
        self.band.pack(fill="x")

        body = tk.Frame(self, bg=BG, padx=14, pady=10)
        body.pack(fill="both", expand=True)
        self.headline = tk.Label(body, text="Starting…", bg=BG, fg=TEXT,
                                 font=("Segoe UI Semibold", 20), anchor="w")
        self.headline.pack(fill="x")
        self.detail = tk.Label(body, text="", bg=BG, fg=TEXT_DIM,
                               font=("Segoe UI", 9), anchor="w",
                               justify="left", wraplength=290)
        self.detail.pack(fill="x", pady=(2, 0))

        self.hold = tk.Canvas(body, height=10, bg=BG, highlightthickness=0)
        self.hold.pack(fill="x", pady=(8, 0))

        row = tk.Frame(body, bg=BG)
        row.pack(fill="x", side="bottom")
        self.arm_var = tk.StringVar(value="")
        tk.Label(row, textvariable=self.arm_var, bg=BG, fg=TEXT_DIM,
                 font=("Segoe UI", 8)).pack(side="left")
        _button(row, "Open Factum", self._open_full, bg=CARD,
                fg=PRIMARY, padx=8, pady=2).pack(side="right")

        self.after(300, self._tick)

    def _hide(self) -> None:
        """Closing the mini panel exits — there is no tray to hide into."""
        self.app._on_close()

    def _open_full(self) -> None:
        self.app.deiconify()
        self.app.lift()
        self.app.focus_force()

    def _tick(self) -> None:
        import everyday

        try:
            state = everyday.status_summary(
                self.app.client, self.app.profile,
                self.app.trigger_tab.detector)
            color = self.LEVEL_COLORS.get(state["level"], TEXT_DIM)
            self.band.configure(bg=color)
            self.headline.configure(text=state["headline"], fg=color)
            self.detail.configure(text=state["detail"])

            detector = self.app.trigger_tab.detector
            self.hold.delete("all")
            if detector is not None:
                width = max(self.hold.winfo_width(), 200)
                self.hold.create_rectangle(0, 2, width, 8, fill="#1f2937",
                                           outline="")
                progress = detector.progress_to_fire()
                if progress > 0:
                    self.hold.create_rectangle(0, 2, int(width * progress), 8,
                                               fill=color, outline="")

            router = self.app.trigger_tab.router
            if router is not None and router.armed:
                self.arm_var.set(f"ARMED — {router.sink.name} "
                                 f"({router.arm_remaining():.0f}s)")
            else:
                self.arm_var.set("not armed — detections are logged only")
        except Exception:
            pass
        self.after(150, self._tick)


# =========================================================== connect dialog


class ConnectDialog(tk.Toplevel):
    """Get the assistant authorised without touching environment variables.

    Deliberately states up front what a Claude subscription does and
    does not cover — expecting the desktop app's login to carry over is
    the obvious assumption, and finding out otherwise after pasting the
    wrong credential is a bad first experience.
    """

    def __init__(self, parent, app: "App", on_done=None) -> None:
        super().__init__(parent)
        self.app = app
        self.on_done = on_done
        self.title("Connect the AI assistant")
        self.configure(bg=BG)
        self.transient(app)
        self.geometry("640x560+%d+%d" % (app.winfo_rootx() + 240,
                                         app.winfo_rooty() + 90))
        self.resizable(False, False)

        tk.Label(self, text="Connect the AI assistant", bg=BG, fg=PRIMARY,
                 font=("Segoe UI Semibold", 15)).pack(anchor="w", padx=18,
                                                      pady=(16, 2))
        tk.Label(self, text=(
            "Claude Desktop and Claude Code are different things. Claude "
            "Desktop is a chat app with no programmatic interface, so no "
            "other program can talk to it. Claude Code is the command-line "
            "tool — that one works, and it runs on your Claude subscription."
        ), bg=BG, fg=TEXT_DIM, font=("Segoe UI", 9), anchor="w",
            justify="left", wraplength=600).pack(fill="x", padx=18)

        # Step 0 — the one that usually needs nothing done to it.
        self.cc_frame = tk.Frame(self, bg=CARD, padx=12, pady=10)
        self.cc_frame.pack(fill="x", padx=18, pady=(12, 0))
        self.cc_title = tk.Label(self.cc_frame, text="", bg=CARD, fg=TEXT,
                                 font=("Segoe UI Semibold", 11), anchor="w")
        self.cc_title.pack(fill="x")
        self.cc_detail = tk.Label(self.cc_frame, text="", bg=CARD, fg=TEXT_DIM,
                                  font=("Segoe UI", 9), anchor="w",
                                  justify="left", wraplength=560)
        self.cc_detail.pack(fill="x", pady=(2, 0))

        self.status_var = tk.StringVar(value="")
        self.status_lbl = tk.Label(self, textvariable=self.status_var, bg=CARD,
                                   fg=TEXT, font=("Segoe UI", 10), padx=12,
                                   pady=10, anchor="w", justify="left",
                                   wraplength=580)
        self.status_lbl.pack(fill="x", padx=18, pady=(12, 0))

        # ---- step 1: package
        step1 = tk.Frame(self, bg=CARD, padx=12, pady=10)
        step1.pack(fill="x", padx=18, pady=(10, 0))
        tk.Label(step1, text="1.  The anthropic package", bg=CARD, fg=TEXT,
                 font=("Segoe UI Semibold", 10)).pack(anchor="w")
        tk.Label(step1, text="Installs into this project's venv only — your "
                             "system Python is untouched.",
                 bg=CARD, fg=TEXT_DIM, font=("Segoe UI", 9),
                 anchor="w").pack(fill="x", pady=(2, 6))
        row1 = tk.Frame(step1, bg=CARD)
        row1.pack(fill="x")
        self.pkg_var = tk.StringVar(value="")
        tk.Label(row1, textvariable=self.pkg_var, bg=CARD, fg=TEXT_DIM,
                 font=("Segoe UI", 9)).pack(side="left")
        self.pkg_btn = _button(row1, "Install", self._install, bg=ACCENT,
                               fg="#000000")
        self.pkg_btn.pack(side="right")

        # ---- step 2: credentials
        step2 = tk.Frame(self, bg=CARD, padx=12, pady=10)
        step2.pack(fill="x", padx=18, pady=(8, 0))
        tk.Label(step2, text="2.  Sign in  (recommended)", bg=CARD, fg=TEXT,
                 font=("Segoe UI Semibold", 10)).pack(anchor="w")
        tk.Label(step2, text=(
            "Opens a browser and stores a short-lived login profile that "
            "every Anthropic tool picks up automatically. Nothing secret is "
            "written into this project. Needs the Anthropic CLI (`ant`)."
        ), bg=CARD, fg=TEXT_DIM, font=("Segoe UI", 9), anchor="w",
            justify="left", wraplength=560).pack(fill="x", pady=(2, 6))
        row2 = tk.Frame(step2, bg=CARD)
        row2.pack(fill="x")
        self.cli_var = tk.StringVar(value="")
        tk.Label(row2, textvariable=self.cli_var, bg=CARD, fg=TEXT_DIM,
                 font=("Segoe UI", 9), anchor="w", justify="left",
                 wraplength=380).pack(side="left")
        _button(row2, "Sign in", self._login, bg=ACCENT,
                fg="#000000").pack(side="right")
        self.cli_btn = _button(row2, "Install CLI", self._install_cli)
        self.cli_btn.pack(side="right", padx=(0, 6))

        # ---- step 3: API key
        step3 = tk.Frame(self, bg=CARD, padx=12, pady=10)
        step3.pack(fill="x", padx=18, pady=(8, 0))
        tk.Label(step3, text="   …or paste an API key", bg=CARD, fg=TEXT,
                 font=("Segoe UI Semibold", 10)).pack(anchor="w")
        tk.Label(step3, text=(
            "From console.anthropic.com. Saved to your Windows user "
            "environment, in plain text — signing in above avoids that."
        ), bg=CARD, fg=TEXT_DIM, font=("Segoe UI", 9), anchor="w",
            justify="left", wraplength=560).pack(fill="x", pady=(2, 6))
        row3 = tk.Frame(step3, bg=CARD)
        row3.pack(fill="x")
        self.key_var = tk.StringVar(value="")
        entry = tk.Entry(row3, textvariable=self.key_var, bg=CARD_ALT, fg=TEXT,
                         insertbackground=TEXT, relief="flat", show="•",
                         font=("Consolas", 10))
        entry.pack(side="left", fill="x", expand=True)
        entry.bind("<Return>", lambda _e: self._save_key())
        _button(row3, "Save", self._save_key, bg=ACCENT,
                fg="#000000").pack(side="right", padx=(6, 0))
        _button(row3, "Get a key", self._open_console).pack(side="right",
                                                            padx=(6, 0))

        footer = tk.Frame(self, bg=BG)
        footer.pack(fill="x", padx=18, pady=(14, 16), side="bottom")
        _button(footer, "Close", self._close, bg=CARD).pack(side="right")
        _button(footer, "Check again", self.refresh).pack(side="right",
                                                          padx=(0, 6))
        _button(footer, "Test connection", self._test, bg=ACCENT,
                fg="#000000").pack(side="right", padx=(0, 6))
        _button(footer, "Remove saved key", self._clear_key, bg=CARD,
                fg=WARN).pack(side="left")

        self.grab_set()
        self.refresh()

    # ------------------------------------------------------------- state

    def refresh(self) -> None:
        import assistant
        import auth

        backend = assistant.status()
        state = auth.describe()
        cli = assistant.claude_cli_path()

        if backend.get("backend") == "claude_cli":
            self.cc_frame.configure(highlightbackground=SUCCESS,
                                    highlightthickness=1)
            self.cc_title.configure(text="✓  Claude Code — IN USE, nothing "
                                         "to set up", fg=SUCCESS)
            self.cc_detail.configure(
                text=f"Found at {cli}\n\nThe assistant is already using it, "
                     f"on your existing Claude subscription. No API key, no "
                     f"separate bill. You can close this window and just ask "
                     f"a question.")
            self.status_var.set(
                "Connected. Everything below is the API fallback — you do "
                "not need any of it.")
            self.status_lbl.configure(fg=SUCCESS)
        else:
            self.cc_frame.configure(highlightbackground=CARD,
                                    highlightthickness=1)
            self.cc_title.configure(text="Claude Code — not found", fg=WARN)
            self.cc_detail.configure(
                text="This is the easiest route: it runs on your Claude "
                     "subscription with no API key. Install it with "
                     "`npm install -g @anthropic-ai/claude-code`, then "
                     "press Check again. Otherwise use the API steps below.")
            self.status_var.set(state["summary"])
            self.status_lbl.configure(fg=SUCCESS if state["ready"] else TEXT)
        if state["warning"]:
            self.status_var.set(state["summary"] + "\n\n" + state["warning"])
            self.status_lbl.configure(fg=WARN)

        self.pkg_var.set("installed" if state["package"] else "not installed")
        self.pkg_btn.configure(state="disabled" if state["package"] else "normal",
                               text="Installed" if state["package"] else "Install")

        if not state["cli_installed"]:
            self.cli_var.set("Anthropic CLI not installed — press Install CLI")
            self.cli_btn.configure(text="Install CLI", state="normal")
        elif state["cli_logged_in"]:
            self.cli_var.set("signed in")
            self.cli_btn.configure(text="CLI installed", state="disabled")
        else:
            self.cli_var.set("CLI installed, not signed in")
            self.cli_btn.configure(text="CLI installed", state="disabled")

    def _close(self) -> None:
        if self.on_done is not None:
            try:
                self.on_done()
            except Exception:
                pass
        self.destroy()

    # ----------------------------------------------------------- actions

    def _install(self) -> None:
        import auth

        self.pkg_btn.configure(state="disabled", text="Installing…")
        self.status_var.set("Installing the anthropic package into the "
                            "project venv — this can take a minute.")
        self.update_idletasks()

        result: Dict[str, Any] = {}

        def work() -> None:
            result.update(auth.install_package())

        thread = threading.Thread(target=work, daemon=True)
        thread.start()

        def poll() -> None:
            if thread.is_alive():
                self.after(250, poll)
                return
            self.refresh()
            (messagebox.showinfo if result.get("ok") else messagebox.showerror)(
                "Install", result.get("message", ""), parent=self)

        self.after(250, poll)

    def _login(self) -> None:
        """Start the sign-in, then WATCH for it to finish.

        The browser flow completes in another process, so without this
        the dialog would sit unchanged and the only way to know it had
        worked would be to guess and press a button. Poll until the
        profile appears, and say so.
        """
        import auth

        result = auth.start_login()
        if not result.get("ok"):
            messagebox.showwarning("Sign in", result["message"], parent=self)
            return

        self.status_var.set("Waiting for you to finish signing in "
                            "in the browser…")
        self.status_lbl.configure(fg=WARN)
        self._login_deadline = time.time() + 300

        def watch() -> None:
            state = auth.describe()
            if state["cli_logged_in"] or state["credential_source"]:
                self.refresh()
                self.status_var.set("Signed in.")
                self.status_lbl.configure(fg=SUCCESS)
                messagebox.showinfo(
                    "Signed in",
                    "Sign-in completed.\n\nPress \"Test connection\" to check "
                    "whether this credential can actually use the API — that "
                    "is a separate question from signing in, and the test is "
                    "the only definitive answer.",
                    parent=self)
                return
            if time.time() > self._login_deadline:
                self.status_var.set(
                    "Stopped waiting for the sign-in. If you completed it, "
                    "press \"Check again\".")
                self.status_lbl.configure(fg=TEXT)
                return
            remaining = int(self._login_deadline - time.time())
            self.status_var.set(
                f"Waiting for you to finish signing in in the browser… "
                f"({remaining}s)\n\nThis panel updates by itself when it "
                f"completes — nothing else to press.")
            self.after(1500, watch)

        self.after(1500, watch)

    def _install_cli(self) -> None:
        """Download and install the Anthropic CLI, checksum-verified."""
        import auth

        if auth.ant_path():
            messagebox.showinfo("Anthropic CLI",
                                f"Already installed:\n\n{auth.ant_path()}",
                                parent=self)
            return
        if not messagebox.askyesno(
            "Install the Anthropic CLI",
            "Browser sign-in is provided by the Anthropic CLI (`ant`) — a "
            "small official tool from Anthropic.\n\n"
            "This downloads the latest release from Anthropic's GitHub, "
            "checks it against the published checksum, and installs it for "
            "your user account only (no admin rights, nothing system-wide).\n\n"
            "Download and install it now?",
            parent=self,
        ):
            return

        self.cli_btn.configure(state="disabled", text="Installing…")
        result: Dict[str, Any] = {}
        messages: List[str] = []

        def work() -> None:
            result.update(auth.install_cli(progress=messages.append))

        thread = threading.Thread(target=work, daemon=True)
        thread.start()

        def poll() -> None:
            if messages:
                self.status_var.set(messages[-1])
            if thread.is_alive():
                self.after(200, poll)
                return
            self.cli_btn.configure(state="normal", text="Install CLI")
            self.refresh()
            (messagebox.showinfo if result.get("ok") else messagebox.showerror)(
                "Anthropic CLI", result.get("message", ""), parent=self)

        self.after(200, poll)

    def _save_key(self) -> None:
        import auth

        result = auth.set_api_key(self.key_var.get())
        if result.get("ok"):
            self.key_var.set("")
            messagebox.showinfo("API key", result["message"], parent=self)
        else:
            messagebox.showerror("API key", result["message"], parent=self)
        self.refresh()

    def _clear_key(self) -> None:
        import auth

        if not messagebox.askyesno(
            "Remove saved key",
            "Remove the stored ANTHROPIC_API_KEY from your user "
            "environment?", parent=self,
        ):
            return
        messagebox.showinfo("API key", auth.clear_api_key()["message"],
                            parent=self)
        self.refresh()

    def _test(self) -> None:
        """One real request — the only definitive answer."""
        import auth

        self.status_var.set("Testing — sending one very small request…")
        self.status_lbl.configure(fg=TEXT)
        self.update_idletasks()

        result: Dict[str, Any] = {}

        def work() -> None:
            result.update(auth.test_connection())

        thread = threading.Thread(target=work, daemon=True)
        thread.start()

        def poll() -> None:
            if thread.is_alive():
                self.after(200, poll)
                return
            self.status_var.set(result.get("message", ""))
            self.status_lbl.configure(fg=SUCCESS if result.get("ok") else ERROR)
            if result.get("ok"):
                messagebox.showinfo("Connection test", result["message"],
                                    parent=self)
            else:
                detail = result.get("detail", "")
                body = result.get("message", "")
                if detail:
                    body += "\n\nDetail:\n" + detail
                messagebox.showerror("Connection test", body, parent=self)

        self.after(200, poll)

    def _open_console(self) -> None:
        import auth
        if not auth.open_console():
            messagebox.showinfo("Get a key",
                                f"Open this in a browser:\n\n{auth.CONSOLE_URL}",
                                parent=self)


# ============================================================= assistant tab


class AssistantTab(tk.Frame):
    """Optional second opinion. Everything here degrades to a message.

    The app must work fully without an API key — sessions happen
    offline, on battery, in a rehab room. So this screen states
    plainly what it can and cannot do rather than failing.
    """

    def __init__(self, master, app: "App") -> None:
        super().__init__(master, bg=BG)
        self.app = app
        self._thread = None

        top = tk.Frame(self, bg=CARD, padx=14, pady=12)
        top.pack(fill="x")
        tk.Label(top, text="AI session assistant", bg=CARD, fg=PRIMARY,
                 font=("Segoe UI Semibold", 13)).pack(side="left")

        # A connection LIGHT, not a sentence to interpret. Guessing
        # whether it is connected is the thing to remove.
        self.chip = tk.Label(top, text="  checking…  ", bg="#334155",
                             fg="#000000", font=("Segoe UI Semibold", 9),
                             padx=10, pady=3)
        self.chip.pack(side="left", padx=(14, 0))

        self.ask_btn = _button(top, "Ask", self._ask, bg=ACCENT, fg="#000000",
                               big=True)
        self.ask_btn.pack(side="right")
        _button(top, "Connect…", self._connect, bg=CARD_ALT,
                fg=PRIMARY).pack(side="right", padx=(0, 8))

        self.state_var = tk.StringVar(value="")
        tk.Label(self, textvariable=self.state_var, bg=BG, fg=TEXT_DIM,
                 font=("Segoe UI", 9), anchor="w", justify="left",
                 wraplength=1100).pack(fill="x", pady=(6, 0))

        # Ready-made questions, so the box is never a blank stare.
        self.suggest_frame = tk.Frame(self, bg=BG)
        self.suggest_frame.pack(fill="x", pady=(8, 0))
        tk.Label(self.suggest_frame, text="Ask about:", bg=BG, fg=TEXT_DIM,
                 font=("Segoe UI", 9)).pack(side="left", padx=(0, 6))
        for label, text in (
            ("What next?",   "What is the single most useful thing to do in "
                             "the next session, and why?"),
            ("Any problems?", "Look at this data critically. What is wrong "
                              "with it, or misleading about it, that I might "
                              "not have noticed?"),
            ("Explain it",   "Explain what these numbers mean in plain "
                             "language, as if to someone who has not seen "
                             "this app before."),
            ("Ideas",        "Suggest movements worth trying that I have not "
                             "recorded yet, and say why each one might "
                             "separate well from the others."),
        ):
            _button(self.suggest_frame, label,
                    lambda t=text: self._preset(t), bg=CARD,
                    fg=PRIMARY).pack(side="left", padx=(0, 6))

        qframe = tk.Frame(self, bg=CARD, padx=14, pady=12)
        qframe.pack(fill="x", pady=(8, 0))
        tk.Label(qframe, text="Ask anything — about this session, the "
                              "project, or what to try next",
                 bg=CARD, fg=TEXT_DIM,
                 font=("Segoe UI", 9)).pack(anchor="w")
        self.question = tk.Text(qframe, height=3, bg=CARD_ALT, fg=TEXT,
                                insertbackground=TEXT, wrap="word",
                                relief="flat", padx=8, pady=6,
                                font=("Segoe UI", 10))
        self.question.pack(fill="x", pady=(4, 0))
        # Enter sends; Shift+Enter makes a new line. A multi-line box
        # that only submits via a button is the reason this looked
        # broken — people press Enter.
        self.question.bind("<Return>", self._on_return)
        self.question.bind("<Shift-Return>", lambda _e: None)
        tk.Label(qframe, text="Enter to send · Shift+Enter for a new line",
                 bg=CARD, fg="#475569",
                 font=("Segoe UI", 8)).pack(anchor="w", pady=(2, 0))

        self.answer = tk.Text(self, bg=CARD, fg=TEXT, wrap="word",
                              relief="flat", padx=14, pady=12,
                              font=("Segoe UI", 10))
        self.answer.pack(fill="both", expand=True, pady=(8, 0))
        self.answer.configure(state="disabled")

        self._asking = False
        # Once a real answer is on screen, the periodic refresh must not
        # overwrite it with the placeholder — that made an answered
        # question look like nothing had happened.
        self._has_answer = False
        self.after(800, self._tick)

    def _tick(self) -> None:
        """Re-check the backend periodically so a sign-in or install that
        happened elsewhere shows up without needing a restart."""
        try:
            if self.winfo_ismapped() and not self._asking and not self._has_answer:
                self._refresh_state()
        except Exception:
            pass
        self.after(4000, self._tick)

    def _preset(self, text: str) -> None:
        """Load a ready-made question and send it."""
        self.question.delete("1.0", "end")
        self.question.insert("1.0", text)
        if self.ask_btn["state"] != "disabled":
            self._ask()

    def _on_return(self, event):
        """Enter sends. Returning "break" stops the newline being typed."""
        if self.ask_btn["state"] != "disabled":
            self._ask()
        return "break"

    def _connect(self) -> None:
        ConnectDialog(self, self.app, on_done=self._refresh_state)

    def _refresh_state(self) -> None:
        """Drive the connection light and say what it will be asked about."""
        import assistant

        state = assistant.status()
        backend = state.get("backend")
        self.ask_btn.configure(
            state="normal" if state["available"] else "disabled")

        if not state["available"]:
            self.chip.configure(text="  NOT CONNECTED  ", bg=ERROR)
        elif backend == "claude_cli":
            self.chip.configure(text="  CONNECTED · Claude Code  ", bg=SUCCESS)
        else:
            self.chip.configure(text="  CONNECTED · API  ", bg=SUCCESS)

        # Say exactly what it will look at, so nothing is a guess.
        prof = self.app.profile
        if prof is None:
            scope = "No profile loaded."
        else:
            arm = prof.active_arm
            sessions = [s for s in prof.sessions(arm) if s.probes()]
            if sessions:
                latest = sessions[-1]
                scope = (f"Will look at {prof.name} / {arm} / "
                         f"{latest.stamp} — {len(latest.probes())} recordings"
                         + (f", plus {len(sessions) - 1} earlier session"
                            f"{'s' if len(sessions) > 2 else ''}"
                            if len(sessions) > 1 else "") + ".")
            else:
                scope = (f"No recordings yet for {prof.name} / {arm} — you can "
                         f"still ask anything about the project.")

        if state["available"]:
            self.state_var.set(state["message"] + "   ·   " + scope)
        else:
            self.state_var.set(state["message"])

        if not state["available"]:
            self._set(
                state["message"] + "\n\n"
                "Press Connect… to set this up.\n\n"
                "Everything else in Factum — recording, analysis, "
                "calibration, the detector and the guide — works without it.")
        else:
            where = ("Claude Code on this machine, running on your existing "
                     "Claude subscription — no API key, no separate bill."
                     if backend == "claude_cli" else
                     "the Anthropic API.")
            self._set(
                f"Connected to {where}\n\n"
                f"{scope}\n\n"
                f"Pick one of the buttons above, or type your own question "
                f"and press Enter. You do not need any recordings to ask "
                f"something — it knows what this project is for.\n\n"
                f"Only summaries are ever sent: metrics, your ratings and "
                f"your notes. Raw recordings never leave this machine.")

    def _ask(self) -> None:
        import assistant
        import calibrate

        import calibrate

        prof = self.app.profile
        arm = prof.active_arm if prof else ""
        sessions = ([s for s in prof.sessions(arm) if s.probes()]
                    if prof else [])
        # No recordings is a perfectly good time to ask a question — it
        # is arguably when advice is worth most. Ask without a payload
        # rather than refusing.
        session = sessions[-1] if sessions else None
        calibration = calibrate.load(prof, arm) if (prof and session) else None

        question = self.question.get("1.0", "end").strip()
        self._asking = True
        self._has_answer = False
        self.ask_btn.configure(state="disabled", text="Asking…")
        self._set("Thinking… (this usually takes a few seconds)")

        result: Dict[str, Any] = {}

        def work() -> None:
            try:
                result.update(assistant.ask(
                    session, question, calibration=calibration,
                    history=sessions[:-1] if sessions else None))
            except Exception as exc:
                result.update({"ok": False, "message": str(exc)})

        self._thread = threading.Thread(target=work, daemon=True)
        self._thread.start()

        def poll() -> None:
            if self._thread.is_alive():
                self.after(200, poll)
                return
            self._asking = False
            self.ask_btn.configure(state="normal", text="Ask")
            if result.get("ok"):
                usage = result.get("usage") or {}
                footer = (f"\n\n— {result.get('model', '?')}, "
                          f"{result.get('payload_bytes', 0):,} bytes sent, "
                          f"{usage.get('output_tokens') or '?'} tokens back")
                if result.get("saved_to"):
                    footer += f"\nSaved to {os.path.basename(result['saved_to'])}"
                self._set(result["text"] + footer)
                self._has_answer = True
                self.question.delete("1.0", "end")
            else:
                self._set(result.get("message", "Something went wrong."))

        self.after(200, poll)

    def _set(self, text: str) -> None:
        self.answer.configure(state="normal")
        self.answer.delete("1.0", "end")
        self.answer.insert("1.0", text)
        self.answer.configure(state="disabled")


# ================================================================ tuning tab


class TuningTab(tk.Frame):
    """What the app has learned about THIS arm, and what it will fire on.

    Every threshold here was measured from the person's own recordings,
    not chosen in advance. The panel exists so those numbers are
    inspectable rather than buried — but nothing here needs touching:
    calibration re-runs itself whenever a session closes.
    """

    def __init__(self, master, app: "App") -> None:
        super().__init__(master, bg=BG)
        self.app = app

        head = tk.Frame(self, bg=CARD, padx=14, pady=12)
        head.pack(fill="x")
        tk.Label(head, text="Signal tuning", bg=CARD, fg=PRIMARY,
                 font=("Segoe UI Semibold", 13)).pack(side="left")
        self.state_var = tk.StringVar(value="")
        tk.Label(head, textvariable=self.state_var, bg=CARD, fg=TEXT_DIM,
                 font=("Segoe UI", 9)).pack(side="left", padx=(12, 0))
        _button(head, "Re-calibrate now", self._recalibrate, bg=ACCENT,
                fg="#000000").pack(side="right")

        tk.Label(self, text=(
            "Thresholds are measured from this arm's own rest recordings "
            "every time a session closes — noise floor, the level resting "
            "muscle never crosses, and how far apart two recordings of the "
            "same state land. Nothing here is a fixed guess."
        ), bg=BG, fg=TEXT_DIM, font=("Segoe UI", 9), anchor="w",
            justify="left", wraplength=1100).pack(fill="x", pady=(8, 0))

        self.body = tk.Text(self, bg=CARD, fg=TEXT, insertbackground=TEXT,
                            wrap="word", relief="flat", padx=14, pady=12,
                            font=("Consolas", 10))
        self.body.pack(fill="both", expand=True, pady=(8, 0))
        self.body.configure(state="disabled")

        self.after(1200, self._tick)

    def _tick(self) -> None:
        if self.winfo_ismapped():
            self.refresh()
        self.after(3000, self._tick)

    def refresh(self) -> None:
        import calibrate
        prof = self.app.profile
        if prof is None:
            self._set("No profile loaded.")
            self.state_var.set("")
            return
        arm = prof.active_arm
        cal = calibrate.load(prof, arm)
        if cal:
            self.state_var.set(f"{prof.name} / {arm} — calibrated "
                               f"{cal.get('generated', '?')} from session "
                               f"{cal.get('source_session', '?')}")
        else:
            self.state_var.set(f"{prof.name} / {arm} — not calibrated yet")
        self._set("\n".join(calibrate.summary_lines(cal)))

    def _set(self, text: str) -> None:
        self.body.configure(state="normal")
        self.body.delete("1.0", "end")
        self.body.insert("1.0", text)
        self.body.configure(state="disabled")

    def _recalibrate(self) -> None:
        import calibrate
        prof = self.app.profile
        if prof is None:
            return
        arm = prof.active_arm
        sessions = [s for s in prof.sessions(arm) if s.probes()]
        if not sessions:
            messagebox.showinfo("Nothing to calibrate from",
                                "Record a rest probe first — the thresholds "
                                "are derived from it.")
            return
        try:
            cal = calibrate.calibrate_session(sessions[-1])
            calibrate.save(prof, arm, cal)
        except Exception as exc:
            messagebox.showerror("Calibration failed", str(exc))
            return
        self.refresh()
        self.app.flash(f"Re-calibrated {arm} from session {sessions[-1].stamp}")


class ScrollHost(tk.Frame):
    """A tab wrapper that scrolls when the window is too small.

    The Session tab in particular is tall — pre-flight, guide,
    walkthrough, record controls, ratings and the probe library stacked
    vertically — and in a windowed (non-maximised) Factum the bottom of
    it was simply cut off with no way to reach it. Content you cannot
    scroll to does not exist, and the record button was in the part that
    vanished.

    The scrollbar only appears when it is needed, so a maximised window
    looks exactly as it did before. The inner frame is kept at the
    canvas's width so nothing has to scroll sideways as well — tables
    and diagrams manage their own horizontal overflow.
    """

    def __init__(self, master) -> None:
        super().__init__(master, bg=BG)
        self.canvas = tk.Canvas(self, bg=BG, highlightthickness=0,
                                borderwidth=0)
        self.vbar = ttk.Scrollbar(self, orient="vertical",
                                  command=self.canvas.yview)
        self.canvas.configure(yscrollcommand=self._on_scroll)
        self.canvas.pack(side="left", fill="both", expand=True)

        self.inner = tk.Frame(self.canvas, bg=BG)
        self._window = self.canvas.create_window((0, 0), window=self.inner,
                                                 anchor="nw")
        self.inner.bind("<Configure>", self._on_inner)
        self.canvas.bind("<Configure>", self._on_canvas)
        # Wheel events go to the widget under the pointer, so bind on
        # enter/leave rather than globally — otherwise scrolling a
        # Treeview or the log would move the page instead.
        self.canvas.bind("<Enter>", lambda _e: self._wheel(True))
        self.canvas.bind("<Leave>", lambda _e: self._wheel(False))

    def _on_scroll(self, first: str, last: str) -> None:
        # Show the bar only when there is somewhere to scroll to.
        if float(first) <= 0.0 and float(last) >= 1.0:
            self.vbar.pack_forget()
        else:
            self.vbar.pack(side="right", fill="y")
        self.vbar.set(first, last)

    def _on_inner(self, _event=None) -> None:
        self.canvas.configure(scrollregion=self.canvas.bbox("all"))

    def _on_canvas(self, event) -> None:
        self.canvas.itemconfigure(self._window, width=event.width)

    def _wheel(self, on: bool) -> None:
        if on:
            self.canvas.bind_all("<MouseWheel>", self._scroll_wheel)
        else:
            self.canvas.unbind_all("<MouseWheel>")

    def _scroll_wheel(self, event) -> None:
        first, last = self.canvas.yview()
        if first <= 0.0 and last >= 1.0:
            return
        self.canvas.yview_scroll(int(-event.delta / 120), "units")


# ================================================================== band tab


class BandTab(tk.Frame):
    """Pair, configure and watch the band — without Mudra Link.

    Everything Link's own UI offers that this project needs: find the
    band, connect it, see battery, firmware, serial and hand, switch
    individual data streams on and off, and route the pointer to HID.

    What it deliberately does NOT do is reimplement Mudra's gesture
    tuning. Those gestures are the thing this project exists to replace,
    because every one of them is defined by fingers touching.

    The Factum defaults button is the whole configuration in one press:

        pointer -> HID     the band moves the cursor natively
        raw signal -> on   Factum classifies it into a click
        gestures  -> off   Mudra's finger-conductance click, disabled
    """

    def __init__(self, master, app: "App") -> None:
        super().__init__(master, bg=BG)
        self.app = app
        self._last_render = 0.0

        # ---- headline state
        head = tk.Frame(self, bg=CARD_ALT, padx=14, pady=12)
        head.pack(fill="x")
        self.state_var = tk.StringVar(value="Starting…")
        self.state_lbl = tk.Label(head, textvariable=self.state_var, bg=CARD_ALT,
                                  fg=TEXT, font=("Segoe UI Semibold", 12),
                                  anchor="w", justify="left", wraplength=1050)
        self.state_lbl.pack(fill="x")
        self.transport_var = tk.StringVar(value="")
        tk.Label(head, textvariable=self.transport_var, bg=CARD_ALT, fg=TEXT_DIM,
                 font=("Segoe UI", 9), anchor="w", justify="left",
                 wraplength=1050).pack(fill="x", pady=(4, 0))

        body = tk.Frame(self, bg=BG)
        body.pack(fill="both", expand=True, pady=(8, 0))
        body.columnconfigure(0, weight=1, uniform="b")
        body.columnconfigure(1, weight=1, uniform="b")
        body.rowconfigure(0, weight=1)

        left = tk.Frame(body, bg=BG)
        left.grid(row=0, column=0, sticky="nsew", padx=(0, 6))
        right = tk.Frame(body, bg=BG)
        right.grid(row=0, column=1, sticky="nsew", padx=(6, 0))

        # ---- pairing
        pair = tk.Frame(left, bg=CARD, padx=12, pady=10)
        pair.pack(fill="both", expand=True)
        tk.Label(pair, text="Bands nearby", bg=CARD, fg=PRIMARY,
                 font=("Segoe UI Semibold", 11)).pack(anchor="w")
        tk.Label(pair, text="A band talks to one host at a time. If it does "
                            "not appear, close Mudra Link and the phone app.",
                 bg=CARD, fg=TEXT_DIM, font=("Segoe UI", 9), anchor="w",
                 justify="left", wraplength=460).pack(fill="x", pady=(2, 6))

        self.band_list = tk.Listbox(pair, height=6, bg=CARD_ALT, fg=TEXT,
                                    selectbackground=ACCENT,
                                    selectforeground="#000000",
                                    relief="flat", font=("Consolas", 9),
                                    activestyle="none",
                                    highlightthickness=0)
        self.band_list.pack(fill="both", expand=True)
        self._addresses: List[str] = []

        row = tk.Frame(pair, bg=CARD)
        row.pack(fill="x", pady=(8, 0))
        self.scan_btn = _button(row, "Scan", self._scan, bg=CARD_ALT, fg=TEXT)
        self.scan_btn.pack(side="left")
        self.connect_btn = _button(row, "Connect", self._connect, bg=ACCENT,
                                   fg="#000000")
        self.connect_btn.pack(side="left", padx=(8, 0))
        self.disconnect_btn = _button(row, "Disconnect", self._disconnect,
                                      bg=CARD_ALT, fg=TEXT)
        self.disconnect_btn.pack(side="left", padx=(8, 0))

        # ---- device facts
        info = tk.Frame(left, bg=CARD, padx=12, pady=10)
        info.pack(fill="x", pady=(8, 0))
        tk.Label(info, text="This band", bg=CARD, fg=PRIMARY,
                 font=("Segoe UI Semibold", 11)).pack(anchor="w")
        self.info_var = tk.StringVar(value="Not connected.")
        tk.Label(info, textvariable=self.info_var, bg=CARD, fg=TEXT,
                 font=("Consolas", 9), anchor="w", justify="left"
                 ).pack(fill="x", pady=(4, 0))
        self.licence_var = tk.StringVar(value="")
        tk.Label(info, textvariable=self.licence_var, bg=CARD, fg=WARN,
                 font=("Segoe UI", 9), anchor="w", justify="left",
                 wraplength=460).pack(fill="x", pady=(6, 0))

        # ---- what the band is sending
        feat = tk.Frame(right, bg=CARD, padx=12, pady=10)
        feat.pack(fill="x")
        tk.Label(feat, text="What the band sends", bg=CARD, fg=PRIMARY,
                 font=("Segoe UI Semibold", 11)).pack(anchor="w")
        tk.Label(feat, text="These are independent switches, not modes — raw "
                            "signal and the pointer can run together.",
                 bg=CARD, fg=TEXT_DIM, font=("Segoe UI", 9), anchor="w",
                 justify="left", wraplength=460).pack(fill="x", pady=(2, 6))

        self.feature_vars: Dict[str, tk.BooleanVar] = {}
        for key, (_setter, label) in _ble_features().items():
            var = tk.BooleanVar(value=False)
            self.feature_vars[key] = var
            tk.Checkbutton(
                feat, text=label, variable=var,
                command=lambda k=key: self._toggle_feature(k),
                bg=CARD, fg=TEXT, selectcolor=CARD_ALT, activebackground=CARD,
                activeforeground=PRIMARY, font=("Segoe UI", 10),
                highlightthickness=0, anchor="w", relief="flat",
            ).pack(fill="x")

        # ---- routing
        route = tk.Frame(right, bg=CARD, padx=12, pady=10)
        route.pack(fill="x", pady=(8, 0))
        tk.Label(route, text="Where the band sends it", bg=CARD, fg=PRIMARY,
                 font=("Segoe UI Semibold", 11)).pack(anchor="w")
        tk.Label(route,
                 text="HID means the band drives the operating system "
                      "directly — the cursor moves with no software in the "
                      "way, on any computer or phone.",
                 bg=CARD, fg=TEXT_DIM, font=("Segoe UI", 9), anchor="w",
                 justify="left", wraplength=460).pack(fill="x", pady=(2, 6))

        self.target_vars: Dict[str, tk.BooleanVar] = {}
        for key, label in (
            ("navigation_to_hid", "Pointer moves the cursor (HID)"),
            ("navigation_to_app", "Pointer comes to Factum instead"),
            ("gesture_to_hid", "Mudra's own gestures click (needs fingertips)"),
        ):
            var = tk.BooleanVar(value=False)
            self.target_vars[key] = var
            tk.Checkbutton(
                route, text=label, variable=var,
                command=lambda k=key: self._toggle_target(k),
                bg=CARD, fg=TEXT, selectcolor=CARD_ALT, activebackground=CARD,
                activeforeground=PRIMARY, font=("Segoe UI", 10),
                highlightthickness=0, anchor="w", relief="flat",
            ).pack(fill="x")

        self.defaults_btn = _button(
            route, "Set this band up for Factum", self._apply_defaults,
            bg=ACCENT, fg="#000000", big=True)
        self.defaults_btn.pack(anchor="w", pady=(10, 0))
        tk.Label(route,
                 text="Cursor to HID on · raw signal on · Mudra's "
                      "fingertip gestures off",
                 bg=CARD, fg=TEXT_DIM, font=("Segoe UI", 8), anchor="w"
                 ).pack(fill="x")

        # ---- live meters, so "is it working" needs no interpretation
        meters = tk.Frame(right, bg=CARD, padx=12, pady=10)
        meters.pack(fill="both", expand=True, pady=(8, 0))
        tk.Label(meters, text="Live signal", bg=CARD, fg=PRIMARY,
                 font=("Segoe UI Semibold", 11)).pack(anchor="w")
        self.meters = [ChannelMeter(meters, i) for i in range(3)]
        for m in self.meters:
            m.pack(fill="x", pady=2)

        # ---- transport choice
        pick = tk.Frame(left, bg=CARD, padx=12, pady=10)
        pick.pack(fill="x", pady=(8, 0))
        tk.Label(pick, text="How Factum reaches the band", bg=CARD, fg=PRIMARY,
                 font=("Segoe UI Semibold", 11)).pack(anchor="w")
        import transport as transport_mod
        self.transport_var_choice = tk.StringVar(
            value=transport_mod.LABELS[transport_mod.preference()])
        box = ttk.Combobox(pick, textvariable=self.transport_var_choice,
                           state="readonly", width=48,
                           values=[transport_mod.LABELS[c]
                                   for c in transport_mod.CHOICES])
        box.pack(anchor="w", pady=(4, 0))
        box.bind("<<ComboboxSelected>>", self._pick_transport)
        tk.Label(pick, text="Changing this takes effect when Factum restarts.",
                 bg=CARD, fg=TEXT_DIM, font=("Segoe UI", 8), anchor="w"
                 ).pack(fill="x", pady=(2, 0))

        # ---- transport log
        logf = tk.Frame(self, bg=CARD, padx=12, pady=8)
        logf.pack(fill="x", pady=(8, 0))
        tk.Label(logf, text="Connection log", bg=CARD, fg=TEXT_DIM,
                 font=("Segoe UI Semibold", 9)).pack(anchor="w")
        self.log_view = tk.Text(logf, height=6, bg=CARD_ALT, fg=TEXT_DIM,
                                relief="flat", wrap="word",
                                font=("Consolas", 8))
        self.log_view.pack(fill="x", pady=(4, 0))
        self.log_view.configure(state="disabled")

        self.after(400, self._tick)

    # ------------------------------------------------------------- actions

    def _is_ble(self) -> bool:
        return getattr(self.app.client, "transport", "") == "ble"

    def _needs_ble(self) -> bool:
        if self._is_ble():
            return False
        messagebox.showinfo(
            "Bluetooth transport not active",
            "Factum is currently talking to the band through Mudra Link, "
            "so pairing is handled there.\n\nTo pair directly, choose the "
            "Bluetooth transport below and restart Factum.")
        return True

    def _scan(self) -> None:
        if self._needs_ble():
            return
        self.app.client.discovered.clear()
        self.app.client.scan()

    def _selected_address(self) -> str:
        sel = self.band_list.curselection()
        if not sel or sel[0] >= len(self._addresses):
            return ""
        return self._addresses[sel[0]]

    def _connect(self) -> None:
        if self._needs_ble():
            return
        address = self._selected_address()
        if not address:
            messagebox.showinfo("Pick a band", "Select a band from the list "
                                               "first, then press Connect.")
            return
        self.app.client.connect(address)

    def _disconnect(self) -> None:
        if not self._needs_ble():
            self.app.client.disconnect()

    def _toggle_feature(self, key: str) -> None:
        if self._needs_ble():
            self.feature_vars[key].set(False)
            return
        self.app.client.toggle_feature(key, bool(self.feature_vars[key].get()))

    def _toggle_target(self, key: str) -> None:
        if self._needs_ble():
            self.target_vars[key].set(False)
            return
        self.app.client.toggle_target(key, bool(self.target_vars[key].get()))

    def _apply_defaults(self) -> None:
        if self._needs_ble():
            return
        self.app.client.use_factum_defaults()
        self.app.flash("Band set up for Factum — cursor via HID, raw signal "
                       "on, Mudra's fingertip gestures off.", 8.0)

    def _pick_transport(self, _evt=None) -> None:
        import transport as transport_mod
        label = self.transport_var_choice.get()
        for choice, text in transport_mod.LABELS.items():
            if text == label:
                transport_mod.set_preference(choice)
                self.app.flash(f"Transport set to {choice}. Restart Factum "
                               f"for it to take effect.", 8.0)
                return

    # -------------------------------------------------------------- render

    def _tick(self) -> None:
        if not self.winfo_ismapped():
            self.after(600, self._tick)
            return
        client = self.app.client
        state = client.signal_state()
        self.state_var.set(client.state_message())
        self.state_lbl.configure(
            fg=SUCCESS if state == STATE_LIVE else
            (WARN if state in (STATE_CONNECTING,) else ERROR))
        self.transport_var.set(
            f"Transport: {getattr(client, 'transport', 'websocket')}   ·   "
            f"{getattr(self.app, 'transport_note', '')}")

        if self._is_ble():
            self._render_ble(client)
        else:
            self.info_var.set(
                "Connected through Mudra Link, so Link owns the pairing.\n"
                "Switch to the Bluetooth transport below to pair here.")

        block = client.snapshot(0.25)
        if block.shape[1] > 0:
            ac = block - block.mean(axis=1, keepdims=True)
            rms = np.sqrt(np.mean(ac * ac, axis=1))
            for i, meter in enumerate(self.meters):
                meter.update_rms(float(rms[i]))
        else:
            for meter in self.meters:
                meter.update_rms(0.0)

        text = self.app.log_text(120)
        if text != getattr(self, "_log_cache", None):
            self._log_cache = text
            self.log_view.configure(state="normal")
            self.log_view.delete("1.0", "end")
            self.log_view.insert("1.0", text)
            self.log_view.see("end")
            self.log_view.configure(state="disabled")

        self.after(500, self._tick)

    def _render_ble(self, client) -> None:
        # Rebuild the list only when it actually changed, or the
        # selection would be yanked out from under a click.
        addresses = list(client.discovered.keys())
        if addresses != self._addresses:
            selected = self._selected_address()
            self._addresses = addresses
            self.band_list.delete(0, "end")
            for address in addresses:
                self.band_list.insert("end", client.discovered[address].label())
            if selected in addresses:
                self.band_list.selection_set(addresses.index(selected))

        device = client.device or {}
        if client.band_connected():
            lines = [
                f"battery    {device.get('battery_pct', '—')}%"
                + ("  (charging)" if device.get("on_charger") else ""),
                f"firmware   {device.get('firmware', '—')}",
                f"serial     {device.get('serial', '—')}",
                f"hand       {device.get('hand', '—')}",
                f"samples    {client.samples_per_second():.0f} /s",
                f"frames     {client.frames_received}",
            ]
            self.info_var.set("\n".join(lines))
        else:
            self.info_var.set("Not connected. Press Scan, pick a band, "
                              "then Connect.")

        licence = client.licence or {}
        if not licence:
            self.licence_var.set("")
        elif licence.get("raw_lock"):
            self.licence_var.set(
                "This band's licence has the RAW LOCK set. If raw signal "
                "never arrives, that is why — the restriction is in the "
                "firmware. Switch to the Mudra Link transport, which holds "
                "a licence, or ask Wearable Devices for one.")
        else:
            self.licence_var.set("Licence: raw signal is not locked.")

        for key, var in self.feature_vars.items():
            var.set(client.feature_enabled(key))
        for key, var in self.target_vars.items():
            var.set(client.target_active(key))


def _ble_features() -> Dict[str, Tuple[str, str]]:
    """Feature table from the BLE client, or a static copy if it is absent."""
    try:
        import mudra_ble
        return dict(mudra_ble.MudraBleClient.FEATURES)
    except Exception:
        return {
            "snc":        ("", "Raw signal (SNC)"),
            "navigation": ("", "Pointer (IMU navigation)"),
            "imu_acc":    ("", "IMU accelerometer"),
            "imu_gyro":   ("", "IMU gyroscope"),
            "gesture":    ("", "Mudra's own gestures"),
            "button":     ("", "Air-mouse button"),
        }


# =================================================================== log tab


class LogTab(tk.Frame):
    """Diagnostics. Deliberately out of the main flow, deliberately complete."""

    def __init__(self, master, app: "App") -> None:
        super().__init__(master, bg=BG)
        self.app = app

        top = tk.Frame(self, bg=CARD, padx=12, pady=10)
        top.pack(fill="x")
        self.state_var = tk.StringVar(value="")
        tk.Label(top, textvariable=self.state_var, bg=CARD, fg=TEXT,
                 font=("Segoe UI", 10), anchor="w", justify="left",
                 wraplength=1100).pack(fill="x")
        self.detail_var = tk.StringVar(value="")
        tk.Label(top, textvariable=self.detail_var, bg=CARD, fg=TEXT_DIM,
                 font=("Consolas", 9), anchor="w", justify="left").pack(fill="x",
                                                                       pady=(6, 0))

        # ---- ranked causes. The router one is first because it is the
        # only cause that leaves every local diagnostic looking healthy.
        causes = tk.Frame(self, bg=BG)
        causes.pack(fill="x", pady=(8, 0))
        tk.Label(causes, text="If the band is paired but no data arrives",
                 bg=BG, fg=PRIMARY, font=("Segoe UI Semibold", 11)).pack(anchor="w")
        tk.Label(causes, text="Most likely first. Stop at the one that fixes it.",
                 bg=BG, fg=TEXT_DIM, font=("Segoe UI", 9)).pack(anchor="w",
                                                                pady=(0, 6))
        for i, (cause, fix) in enumerate(app.client.troubleshooting_causes(), 1):
            card = tk.Frame(causes, bg=CARD, padx=12, pady=8)
            card.pack(fill="x", pady=2)
            head = tk.Frame(card, bg=CARD)
            head.pack(fill="x")
            tk.Label(head, text=f"{i}.", bg=CARD,
                     fg=ERROR if i == 1 else PRIMARY,
                     font=("Consolas", 11, "bold")).pack(side="left", padx=(0, 8))
            tk.Label(head, text=cause, bg=CARD, fg=TEXT,
                     font=("Segoe UI Semibold", 10), anchor="w",
                     justify="left", wraplength=1000).pack(side="left")
            tk.Label(card, text=fix, bg=CARD, fg=TEXT_DIM, font=("Segoe UI", 9),
                     anchor="w", justify="left",
                     wraplength=1040).pack(fill="x", padx=(24, 0), pady=(2, 0))

        # ---- known-good sequence + event log
        bottom = tk.Frame(self, bg=BG)
        bottom.pack(fill="both", expand=True, pady=(10, 0))
        bottom.columnconfigure(0, weight=1, uniform="log")
        bottom.columnconfigure(1, weight=1, uniform="log")
        bottom.rowconfigure(1, weight=1)

        tk.Label(bottom, text="Known-good startup sequence", bg=BG, fg=PRIMARY,
                 font=("Segoe UI Semibold", 11)).grid(row=0, column=0, sticky="w")
        steps = tk.Frame(bottom, bg=CARD, padx=12, pady=8)
        steps.grid(row=1, column=0, sticky="nsew", padx=(0, 6), pady=(4, 0))
        for i, step in enumerate(app.client.known_good_sequence(), 1):
            row = tk.Frame(steps, bg=CARD)
            row.pack(fill="x", pady=1)
            tk.Label(row, text=f"{i}.", bg=CARD, fg=PRIMARY,
                     font=("Consolas", 10, "bold"), width=3,
                     anchor="ne").pack(side="left")
            tk.Label(row, text=step, bg=CARD, fg=TEXT, font=("Segoe UI", 9),
                     anchor="w", justify="left", wraplength=460
                     ).pack(side="left", fill="x", expand=True)

        tk.Label(bottom, text="Connection events", bg=BG, fg=PRIMARY,
                 font=("Segoe UI Semibold", 11)).grid(row=0, column=1, sticky="w")
        self.log_text = tk.Text(bottom, bg=CARD_ALT, fg=TEXT, insertbackground=TEXT,
                                wrap="none", relief="flat", font=("Consolas", 9))
        self.log_text.grid(row=1, column=1, sticky="nsew", padx=(6, 0), pady=(4, 0))
        self.log_text.configure(state="disabled")

        self.after(1000, self._tick)

    def _tick(self) -> None:
        client = self.app.client
        state = client.signal_state()
        self.state_var.set(f"{STATE_LABELS.get(state, state)} — {client.state_message()}")

        dev = client.device
        parts = [
            f"endpoint {client.active_url}",
            f"band state: {dev.get('state') or 'unknown'}",
            f"frames {client.frames_received:,}",
            f"samples {client.samples_received:,}",
            f"{client.samples_per_second():,.0f}/s",
        ]
        # Show that the app really is polling — "it just sat there" is
        # otherwise indistinguishable from "nothing changed".
        if client.last_poll_ts:
            parts.append(f"polled {time.time() - client.last_poll_ts:.0f}s ago")
        if dev.get("name"):
            parts.append(f"device {dev['name']}")
        if dev.get("firmware"):
            parts.append(f"fw {dev['firmware']}")
        if dev.get("battery") is not None:
            parts.append(f"battery {dev['battery']}%"
                         + (" charging" if dev.get("charging") else ""))
        if client.last_error:
            parts.append(f"last error: {client.last_error}")
        self.detail_var.set("   ·   ".join(parts))

        if self.winfo_ismapped():
            self.log_text.configure(state="normal")
            self.log_text.delete("1.0", "end")
            for ts, msg in list(client.log)[-60:]:
                self.log_text.insert("end",
                                     f"{time.strftime('%H:%M:%S', time.localtime(ts))}  {msg}\n")
            if client.unknown_types:
                self.log_text.insert("end", "\nUnknown message types: " + ", ".join(
                    f"{k}x{v}" for k, v in client.unknown_types.items()) + "\n")
            self.log_text.configure(state="disabled")
            self.log_text.see("end")
        self.after(1000, self._tick)


# ================================================ advanced: contact tab


class ChannelMeter(tk.Frame):
    def __init__(self, master, ch: int) -> None:
        super().__init__(master, bg=CARD, padx=8, pady=6)
        self.ch = ch
        self.rms_var = tk.StringVar(value=f"ch{ch+1}   RMS 0.0000   peak 0.0000")
        tk.Label(self, textvariable=self.rms_var, bg=CARD, fg=TEXT,
                 font=("Consolas", 10)).pack(anchor="w")
        self.canvas = tk.Canvas(self, height=28, bg=CARD_ALT,
                                highlightthickness=1, highlightbackground="#1f2937")
        self.canvas.pack(fill="x", expand=True, pady=(4, 0))
        self._peak = 0.0
        self._peak_ts = time.time()

    def update_rms(self, rms: float) -> None:
        now = time.time()
        if rms > self._peak:
            self._peak, self._peak_ts = float(rms), now
        elif now - self._peak_ts > 1.5:
            self._peak = max(rms, self._peak * 0.92)

        w = max(self.canvas.winfo_width(), 100)
        h = self.canvas.winfo_height()
        self.canvas.delete("all")
        color = "#334155" if rms < 0.01 else (WARN if rms < 0.03 else SUCCESS)
        self.canvas.create_rectangle(0, 0, int(w * min(rms / 0.3, 1.0)), h,
                                     fill=color, outline="")
        peak_x = int(w * min(self._peak / 0.3, 1.0))
        if peak_x > 2:
            self.canvas.create_line(peak_x, 0, peak_x, h, fill=PRIMARY, width=2)
        self.rms_var.set(f"ch{self.ch+1}   RMS {rms:.4f}   peak {self._peak:.4f}")


class ContactTab(tk.Frame):
    """Advanced: live contact quality while positioning the band."""

    def __init__(self, master, app: "App") -> None:
        super().__init__(master, bg=BG)
        self.app = app
        self.columnconfigure(0, weight=1, uniform="c")
        self.columnconfigure(1, weight=1, uniform="c")
        self.rowconfigure(0, weight=1)

        left = tk.Frame(self, bg=BG)
        left.grid(row=0, column=0, sticky="nsew", padx=(0, 8))
        tk.Label(left, text="Contact quality", bg=BG, fg=PRIMARY,
                 font=("Segoe UI Semibold", 11)).pack(anchor="w", pady=(0, 4))
        self.verdict_var = tk.StringVar(value="Waiting for signal…")
        self.verdict_label = tk.Label(left, textvariable=self.verdict_var, bg=CARD,
                                      fg=TEXT, font=("Segoe UI", 11, "bold"),
                                      padx=12, pady=10, anchor="w",
                                      justify="left", wraplength=430)
        self.verdict_label.pack(fill="x")
        self.report_text = tk.Text(left, height=18, bg=CARD, fg=TEXT,
                                   insertbackground=TEXT, wrap="word", relief="flat",
                                   padx=10, pady=8, font=("Consolas", 9))
        self.report_text.pack(fill="both", expand=True, pady=(8, 0))
        self.report_text.configure(state="disabled")

        right = tk.Frame(self, bg=BG)
        right.grid(row=0, column=1, sticky="nsew", padx=(8, 0))
        tk.Label(right, text="Live RMS meters", bg=BG, fg=PRIMARY,
                 font=("Segoe UI Semibold", 11)).pack(anchor="w", pady=(0, 4))
        tk.Label(right, text=(
            "Move the band around the forearm and watch these. You want the "
            "three bars to move INDEPENDENTLY when he attempts different "
            "movements. If they all move together, keep repositioning."
        ), bg=BG, fg=TEXT_DIM, font=("Segoe UI", 9), justify="left",
            wraplength=430).pack(anchor="w", pady=(0, 8))
        self.meters = [ChannelMeter(right, i) for i in range(3)]
        for m in self.meters:
            m.pack(fill="x", pady=4)

        corr = tk.Frame(right, bg=CARD, padx=10, pady=8)
        corr.pack(fill="x", pady=(8, 0))
        tk.Label(corr, text="Pair correlations (want < 0.7)", bg=CARD, fg=TEXT_DIM,
                 font=("Segoe UI", 9)).pack(anchor="w")
        self.corr_var = tk.StringVar(value="1-2 —   1-3 —   2-3 —")
        tk.Label(corr, textvariable=self.corr_var, bg=CARD, fg=TEXT,
                 font=("Consolas", 11)).pack(anchor="w", pady=(2, 0))

        # ---- where the band is, pointed at rather than described
        #
        # This replaced a free-text box. "3 fingers below elbow, mark A"
        # cannot be reproduced by a different helper three weeks later,
        # and placement drift is not cosmetic: rotate the band far
        # enough and the ulnar electrode sits over the median group, so
        # an identical movement produces a different signal and the
        # analysis truthfully reports that the movement drifted.
        place = tk.Frame(right, bg=CARD, padx=10, pady=8)
        place.pack(fill="x", pady=(8, 0))

        # Header row: title + arm switcher. The header switcher exists
        # too, but the diagram is the thing the helper is reading —
        # so mirror it here, prominent and adjacent.
        head_row = tk.Frame(place, bg=CARD)
        head_row.pack(fill="x")
        tk.Label(head_row, text="Where is the band sitting?",
                 bg=CARD, fg=PRIMARY, font=("Segoe UI Semibold", 10)
                 ).pack(side="left")
        arm_switch = tk.Frame(head_row, bg=CARD)
        arm_switch.pack(side="right")
        tk.Label(arm_switch, text="arm:", bg=CARD, fg=TEXT_DIM,
                 font=("Segoe UI", 9)).pack(side="left", padx=(0, 6))
        self._arm_switch_btns: Dict[str, tk.Button] = {}
        for arm in ARMS:
            b = tk.Button(arm_switch, text=arm.upper(),
                          bg=CARD_ALT, fg=TEXT, relief="flat",
                          font=("Segoe UI Semibold", 9), padx=10, pady=2,
                          command=lambda a=arm: self._pick_arm(a))
            b.pack(side="left", padx=1)
            self._arm_switch_btns[arm] = b

        self.limb_var = tk.StringVar(value="")
        tk.Label(place, textvariable=self.limb_var, bg=CARD, fg=TEXT_DIM,
                 font=("Segoe UI", 9), wraplength=760, justify="left",
                 anchor="w").pack(fill="x", pady=(2, 6))

        # Prominent "switch to the placeable arm" button, only shown
        # when the current arm is not placeable but another is.
        self.switch_hint = tk.Frame(place, bg=CARD)
        self.switch_hint_btn = tk.Button(
            self.switch_hint, text="",
            bg=ACCENT, fg="#000000", relief="flat",
            font=("Segoe UI Semibold", 10), padx=14, pady=6,
            command=self._switch_to_placeable)
        self.switch_hint_btn.pack(side="left")

        # Fixed size — a measurement instrument that must not resize.
        # If the surrounding tab is narrower than the diagram, the
        # canvas scrolls; it does not shrink. See placement_contract.py
        # for why the diagram's dimensions are load-bearing.
        import anatomy as _anat
        diag_wrap = tk.Frame(place, bg=BG)
        diag_wrap.pack(fill="x")
        hbar = tk.Scrollbar(diag_wrap, orient="horizontal")
        self.limb_canvas = tk.Canvas(
            diag_wrap,
            width=_anat.DIAGRAM_W, height=_anat.DIAGRAM_H,
            bg=BG, highlightthickness=0,
            xscrollcommand=hbar.set,
            scrollregion=(0, 0, _anat.DIAGRAM_W, _anat.DIAGRAM_H))
        hbar.config(command=self.limb_canvas.xview)
        self.limb_canvas.pack(side="top", anchor="nw")
        hbar.pack(side="top", fill="x")
        self.diagram: Optional[Any] = None

        self.drift_var = tk.StringVar(value="")
        tk.Label(place, textvariable=self.drift_var, bg=CARD, fg=WARN,
                 font=("Segoe UI", 9), wraplength=430, justify="left",
                 anchor="w").pack(fill="x", pady=(6, 0))

        row = tk.Frame(place, bg=CARD)
        row.pack(anchor="w", pady=(6, 0))
        _button(row, "Save this placement", self._save_placement, bg=ACCENT,
                fg="#000000").pack(side="left")
        _button(row, "How to put it there", self._show_placement_steps,
                bg=CARD_ALT, fg=TEXT).pack(side="left", padx=(8, 0))
        self.save_status = tk.StringVar(value="")
        tk.Label(row, textvariable=self.save_status, bg=CARD, fg=TEXT_DIM,
                 font=("Segoe UI", 9)).pack(side="left", padx=8)

        self.after(200, self._tick)
        self.after(300, self.refresh_limb)

    # ------------------------------------------------------ the diagram

    def refresh_limb(self) -> None:
        """Rebuild the diagram for whichever arm is active.

        Always rebuilds — an in-place limb/placement swap is easy to get
        wrong when the active PROFILE changes, and the diagram is cheap
        enough to recreate that caching it is not worth the class of
        bug it hides.
        """
        import anatomy
        prof = self.app.profile
        if prof is None:
            self.limb_var.set("Pick a profile first.")
            return
        arm = prof.active_arm
        limb = prof.limb(arm)
        placement = prof.placement(arm)
        if placement is None:
            placement = anatomy.Placement(
                arm=arm,
                distance_mm=limb.default_distance_mm(),
                on_upper_arm=not limb.has_forearm)
        self._saved_placement = prof.placement(arm)

        text = limb.headline()
        if limb.caution():
            text += "\n\n" + limb.caution()
        self.limb_var.set(text)

        self.diagram = anatomy.LimbDiagram(
            self.limb_canvas, limb, placement,
            palette=anatomy.Palette(bg=BG, band=ACCENT, text=TEXT,
                                    dim=TEXT_DIM, warn=WARN, bad=ERROR,
                                    ok=SUCCESS),
            on_change=self._on_placement_moved,
            profile_name=prof.name)
        self.diagram.redraw()
        self._on_placement_moved(placement)
        self._sync_arm_switcher(prof, arm)

    def _sync_arm_switcher(self, prof, arm: str) -> None:
        """Highlight the active arm; show 'switch to X' only when useful."""
        for a, btn in self._arm_switch_btns.items():
            if a == arm:
                btn.configure(bg=ACCENT, fg="#000000")
            else:
                btn.configure(bg=CARD_ALT, fg=TEXT)
        current_limb = prof.limb(arm)
        placeable_others = [a for a in ARMS
                            if a != arm and prof.limb(a).has_forearm]
        if not current_limb.has_forearm and placeable_others:
            other = placeable_others[0]
            self.switch_hint_btn.configure(
                text=f"Switch to {other.upper()} arm to set placement")
            self.switch_hint_btn.pack_configure(side="left")
            self.switch_hint.pack(anchor="w", pady=(6, 4))
            self.switch_hint._target_arm = other  # type: ignore[attr-defined]
        else:
            self.switch_hint.pack_forget()

    def _pick_arm(self, arm: str) -> None:
        if self.app.profile is None or self.app.profile.active_arm == arm:
            return
        self.app.profile.active_arm = arm
        self.app.profile.save()
        self.app.on_context_changed()

    def _switch_to_placeable(self) -> None:
        target = getattr(self.switch_hint, "_target_arm", None)
        if target:
            self._pick_arm(target)

    def _on_placement_moved(self, placement) -> None:
        self.drift_var.set(placement.drift_from(self._saved_placement))

    def _save_placement(self) -> None:
        if self.app.profile is None or self.diagram is None:
            self.save_status.set("No profile.")
            return
        placement = self.diagram.placement
        if not self.diagram.limb.has_forearm:
            placement.on_upper_arm = True
        self.app.profile.set_placement(placement)
        self._saved_placement = placement
        self.drift_var.set("")
        self.save_status.set("saved — stamped into every probe from now on")

    def _show_placement_steps(self) -> None:
        import anatomy
        if self.diagram is None:
            return
        steps = anatomy.placement_steps(self.diagram.limb,
                                        self.diagram.placement)
        body = "\n\n".join(f"{i}. {s}" for i, s in enumerate(steps, 1))
        messagebox.showinfo("Putting the band exactly here", body)

    def _tick(self) -> None:
        if not self.winfo_ismapped():
            self.after(500, self._tick)
            return
        meter_snap = self.app.client.snapshot(0.25)
        if meter_snap.shape[1] > 0:
            ac = meter_snap - meter_snap.mean(axis=1, keepdims=True)
            rms = np.sqrt(np.mean(ac * ac, axis=1))
            for i, meter in enumerate(self.meters):
                meter.update_rms(float(rms[i]))
        else:
            for meter in self.meters:
                meter.update_rms(0.0)

        window = self.app.client.snapshot(1.0)
        if window.shape[1] > 0:
            metrics = compute_metrics(window)
            verdict = evaluate(metrics)
            self.verdict_label.configure(
                fg={"pass": SUCCESS, "warn": WARN}.get(verdict.severity, ERROR))
            self.verdict_var.set(verdict.headline)
            self.report_text.configure(state="normal")
            self.report_text.delete("1.0", "end")
            self.report_text.insert("1.0", format_report(verdict))
            self.report_text.configure(state="disabled")
            self.corr_var.set(f"1-2 {metrics.corr[0,1]:+.2f}   "
                              f"1-3 {metrics.corr[0,2]:+.2f}   "
                              f"2-3 {metrics.corr[1,2]:+.2f}")
        else:
            self.verdict_var.set("Waiting for data…")
            self.verdict_label.configure(fg=TEXT_DIM)
        self.after(200, self._tick)


# ================================================ advanced: profile tab


class ProfileTab(tk.Frame):
    """Advanced: the full record — notes, sessions, reports, delete."""

    def __init__(self, master, app: "App") -> None:
        super().__init__(master, bg=BG)
        self.app = app

        top = tk.Frame(self, bg=CARD, padx=12, pady=10)
        top.pack(fill="x")
        self.title_var = tk.StringVar(value="No profile loaded")
        tk.Label(top, textvariable=self.title_var, bg=CARD, fg=PRIMARY,
                 font=("Segoe UI Semibold", 14)).pack(side="left")
        self.meta_var = tk.StringVar(value="")
        tk.Label(top, textvariable=self.meta_var, bg=CARD, fg=TEXT_DIM,
                 font=("Segoe UI", 9)).pack(side="left", padx=(12, 0))
        _button(top, "Delete profile…", self._delete_profile, bg=CARD_ALT,
                fg=ERROR).pack(side="right")
        _button(top, "Verify data", self._verify).pack(side="right", padx=(0, 6))
        _button(top, "Open folder", lambda: _reveal(
            self.app.profile.root if self.app.profile else "")).pack(
            side="right", padx=(0, 6))

        notes_card = tk.Frame(self, bg=CARD, padx=12, pady=10)
        notes_card.pack(fill="x", pady=(8, 0))
        row = tk.Frame(notes_card, bg=CARD)
        row.pack(fill="x")
        tk.Label(row, text="Profile notes", bg=CARD, fg=TEXT_DIM,
                 font=("Segoe UI", 9)).pack(side="left")
        self.notes_status = tk.StringVar(value="")
        tk.Label(row, textvariable=self.notes_status, bg=CARD, fg=TEXT_DIM,
                 font=("Segoe UI", 9)).pack(side="right")
        self.notes_text = tk.Text(notes_card, height=3, bg=CARD_ALT, fg=TEXT,
                                  insertbackground=TEXT, wrap="word", relief="flat",
                                  font=("Segoe UI", 10))
        self.notes_text.pack(fill="x", pady=(4, 4))
        _button(notes_card, "Save notes", self._save_notes, bg=ACCENT,
                fg="#000000").pack(anchor="e")

        arms = tk.Frame(self, bg=BG)
        arms.pack(fill="both", expand=True, pady=(8, 0))
        arms.columnconfigure(0, weight=1, uniform="cols")
        arms.columnconfigure(1, weight=1, uniform="cols")
        arms.rowconfigure(0, weight=1)
        self.arm_panels: Dict[str, "ArmPanel"] = {}
        for col, arm in enumerate((ARM_LEFT, ARM_RIGHT)):
            panel = ArmPanel(arms, self.app, arm)
            panel.grid(row=0, column=col, sticky="nsew",
                       padx=(0, 4) if col == 0 else (4, 0))
            self.arm_panels[arm] = panel

        self.after(500, self._tick)

    def refresh(self) -> None:
        prof = self.app.profile
        if prof is None:
            self.title_var.set("No profile loaded")
            self.meta_var.set("")
            for panel in self.arm_panels.values():
                panel.refresh()
            return
        self.title_var.set(f"{prof.name}   ({prof.type})")
        self.meta_var.set(f"created {prof.created_utc or '—'}   ·   "
                          f"active arm: {prof.active_arm}   ·   "
                          f"open sessions: "
                          f"{', '.join(prof.active_session.keys()) or 'none'}")
        current = self.notes_text.get("1.0", "end").rstrip("\n")
        if current != (prof.notes or "") and self.focus_get() is not self.notes_text:
            self.notes_text.delete("1.0", "end")
            self.notes_text.insert("1.0", prof.notes or "")
        for panel in self.arm_panels.values():
            panel.refresh()

    def _tick(self) -> None:
        try:
            if self.winfo_ismapped():
                self.refresh()
        finally:
            self.after(1500, self._tick)

    def _save_notes(self) -> None:
        if self.app.profile is None:
            return
        self.app.profile.set_notes(self.notes_text.get("1.0", "end").rstrip("\n"))
        self.notes_status.set("saved")
        self.after(2000, lambda: self.notes_status.set(""))

    def _verify(self) -> None:
        """Re-hash every recording and report anything that changed."""
        import integrity

        prof = self.app.profile
        if prof is None:
            return
        summary = integrity.profile_summary(prof)
        result = integrity.verify_profile(prof)
        header = (f"{summary['probes']} probes across {summary['sessions']} "
                  f"sessions — {summary['recorded_minutes']} minutes recorded.")
        if not result.get("available"):
            integrity.save_manifest(prof)
            messagebox.showinfo(
                "Baseline recorded",
                f"{header}\n\nNo manifest existed, so one has been written "
                f"now. From here on, any change to a finalised recording "
                f"will be detected.")
            return
        detail = [header, "", result["summary"]]
        for key, label in (("changed", "CHANGED since recording"),
                           ("missing", "MISSING"),
                           ("unreadable", "UNREADABLE")):
            if result.get(key):
                detail.append("")
                detail.append(f"{label}:")
                detail += [f"  {p}" for p in result[key][:12]]
        if result.get("added"):
            detail.append("")
            detail.append(f"{len(result['added'])} new file(s) since the last "
                          f"check — expected if you have recorded since.")
        (messagebox.showinfo if result["ok"] else messagebox.showwarning)(
            "Data integrity", "\n".join(detail))
        integrity.save_manifest(prof)

    def _delete_profile(self) -> None:
        if self.app.profile is None:
            return
        name = self.app.profile.name
        if not messagebox.askyesno(
            "Delete profile?",
            f"Permanently delete profile '{name}' and every recording and "
            f"note under it?\n\nThis cannot be undone.",
        ):
            return
        typed = simpledialog.askstring(
            "Confirm delete",
            f"Type the profile name '{name}' to confirm deletion:", parent=self)
        if typed != name:
            messagebox.showinfo("Cancelled", "Name did not match — nothing deleted.")
            return
        try:
            self.app.store.delete(name)
        except Exception as exc:
            messagebox.showerror("Delete failed", str(exc))
            return
        self.app.profile = None
        self.app.header.refresh()
        self.refresh()
        self.app._boot_profile()


class ArmPanel(tk.Frame):
    """Left- or right-arm sub-tree view inside the Profile tab."""

    def __init__(self, master, app: "App", arm: str) -> None:
        super().__init__(master, bg=CARD, padx=10, pady=10)
        self.app = app
        self.arm = arm

        head = tk.Frame(self, bg=CARD)
        head.pack(fill="x")
        tk.Label(head, text=arm.upper(), bg=CARD, fg=PRIMARY,
                 font=("Segoe UI Semibold", 12)).pack(side="left")
        self.status_var = tk.StringVar(value="")
        tk.Label(head, textvariable=self.status_var, bg=CARD, fg=TEXT_DIM,
                 font=("Segoe UI", 9)).pack(side="left", padx=(8, 0))
        _button(head, "Make active", self._make_active, bg=CARD_ALT,
                fg=PRIMARY).pack(side="right")

        tk.Label(self, text="Placement notes", bg=CARD, fg=TEXT_DIM,
                 font=("Segoe UI", 9)).pack(anchor="w", pady=(10, 2))
        self.notes_view = tk.Text(self, height=5, bg=CARD_ALT, fg=TEXT,
                                  insertbackground=TEXT, wrap="word", relief="flat",
                                  font=("Consolas", 9))
        self.notes_view.pack(fill="x")
        self.notes_view.configure(state="disabled")

        row = tk.Frame(self, bg=CARD)
        row.pack(fill="x", pady=(4, 0))
        self.note_var = tk.StringVar(value="")
        entry = tk.Entry(row, textvariable=self.note_var, bg=CARD_ALT, fg=TEXT,
                         insertbackground=TEXT, relief="flat", font=("Segoe UI", 10))
        entry.pack(side="left", fill="x", expand=True)
        entry.bind("<Return>", lambda _e: self._add_note())
        _button(row, "Add note", self._add_note, bg=ACCENT,
                fg="#000000").pack(side="left", padx=(6, 0))

        tk.Label(self, text="Sessions", bg=CARD, fg=TEXT_DIM,
                 font=("Segoe UI", 9)).pack(anchor="w", pady=(10, 2))
        list_frame = tk.Frame(self, bg=CARD_ALT)
        list_frame.pack(fill="both", expand=True)
        cols = ("stamp", "state", "probes", "report")
        self.sess_tree = ttk.Treeview(list_frame, columns=cols, show="headings",
                                      height=8, selectmode="browse")
        for c, w in zip(cols, (140, 80, 60, 70)):
            self.sess_tree.heading(c, text=c)
            self.sess_tree.column(c, width=w, anchor="w")
        self.sess_tree.pack(side="left", fill="both", expand=True)
        sb = ttk.Scrollbar(list_frame, orient="vertical", command=self.sess_tree.yview)
        sb.pack(side="right", fill="y")
        self.sess_tree.configure(yscrollcommand=sb.set)
        self.sess_tree.bind("<Double-1>", lambda _e: self._open_report())

        btns = tk.Frame(self, bg=CARD)
        btns.pack(fill="x", pady=(6, 0))
        _button(btns, "Open REPORT.md", self._open_report).pack(side="left")
        _button(btns, "Folder", self._reveal_session).pack(side="left", padx=(6, 0))
        _button(btns, "Reopen", self._reopen_session, fg=PRIMARY).pack(side="left",
                                                                      padx=(6, 0))
        _button(btns, "Close & analyse", self._close_open_session,
                fg=WARN).pack(side="right")

    def refresh(self) -> None:
        prof = self.app.profile
        if prof is None:
            self.status_var.set("")
            self._set_notes_view("")
            self.sess_tree.delete(*self.sess_tree.get_children())
            return
        parts = []
        if prof.active_arm == self.arm:
            parts.append("ACTIVE")
        open_stamp = prof.active_session.get(self.arm)
        if open_stamp:
            parts.append(f"session {open_stamp} open")
        self.status_var.set("   ·   ".join(parts) if parts else "idle")
        self._set_notes_view(prof.read_placement_notes(self.arm))

        self.sess_tree.delete(*self.sess_tree.get_children())
        for sess in reversed(prof.sessions(self.arm)):
            info = sess.summary()
            state = ("OPEN" if prof.active_session.get(self.arm) == sess.stamp
                     else ("closed" if info["ended"] else "abandoned"))
            self.sess_tree.insert("", "end", iid=sess.stamp,
                                  values=(sess.stamp, state, info["n_probes"],
                                          "yes" if info["analysed"] else "—"))

    def _set_notes_view(self, text: str) -> None:
        self.notes_view.configure(state="normal")
        self.notes_view.delete("1.0", "end")
        self.notes_view.insert("1.0", text or "(no placement notes for this arm yet)")
        self.notes_view.configure(state="disabled")

    def _selected(self) -> Optional[str]:
        sel = self.sess_tree.selection()
        return sel[0] if sel else None

    def _make_active(self) -> None:
        if self.app.profile is None or self.app.profile.active_arm == self.arm:
            return
        self.app.profile.active_arm = self.arm
        self.app.profile.save()
        self.app.on_context_changed()

    def _add_note(self) -> None:
        if self.app.profile is None:
            return
        note = self.note_var.get().strip()
        if not note:
            return
        self.app.profile.append_placement_note(self.arm, note)
        self.note_var.set("")
        self.refresh()

    def _reveal_session(self) -> None:
        prof = self.app.profile
        if prof is None:
            return
        stamp = self._selected()
        _reveal(prof.get_session(self.arm, stamp).root if stamp
                else prof.sessions_dir(self.arm))

    def _open_report(self) -> None:
        prof = self.app.profile
        stamp = self._selected()
        if prof is None or stamp is None:
            return
        report = prof.get_session(self.arm, stamp).report_md
        if not os.path.exists(report):
            messagebox.showinfo(
                "No report yet",
                "That session has not been analysed. Close it (or reopen and "
                "close it) and the report is written automatically.")
            return
        _reveal(report)

    def _reopen_session(self) -> None:
        prof = self.app.profile
        stamp = self._selected()
        if prof is None or stamp is None:
            messagebox.showinfo("No session picked", "Select a session first.")
            return
        current = prof.active_session.get(self.arm)
        if current and current != stamp:
            if not messagebox.askyesno(
                "Close current session?",
                f"Session {current} is open on {self.arm}. Close and analyse "
                f"it, then reopen {stamp}?",
            ):
                return
            self.app.close_session_with_progress(self.arm)
        try:
            prof.reopen_session(self.arm, stamp)
        except Exception as exc:
            messagebox.showerror("Reopen failed", str(exc))
            return
        self.app.on_context_changed()

    def _close_open_session(self) -> None:
        prof = self.app.profile
        if prof is None or not prof.has_open_session(self.arm):
            return
        self.app.close_session_with_progress(self.arm)


# ------------------------------------------------------ new-profile dialog


class NewProfileDialog(tk.Toplevel):
    def __init__(self, parent, app: "App") -> None:
        super().__init__(parent)
        self.app = app
        self.title("New profile")
        self.configure(bg=BG)
        self.transient(parent.winfo_toplevel())
        self.resizable(False, False)
        self.geometry("+%d+%d" % (parent.winfo_rootx() + 40, parent.winfo_rooty() + 40))
        pad = {"padx": 12, "pady": 6}

        tk.Label(self, text="Name (a-z, 0-9, -, _)", bg=BG, fg=TEXT_DIM,
                 font=("Segoe UI", 9)).grid(row=0, column=0, sticky="w", **pad)
        self.name_var = tk.StringVar()
        entry = tk.Entry(self, textvariable=self.name_var, bg=CARD_ALT, fg=TEXT,
                         insertbackground=TEXT, relief="flat", width=32,
                         font=("Segoe UI", 10))
        entry.grid(row=1, column=0, sticky="ew", **pad)
        entry.bind("<Return>", lambda _e: self._create())

        tk.Label(self, text="Type", bg=BG, fg=TEXT_DIM,
                 font=("Segoe UI", 9)).grid(row=2, column=0, sticky="w", **pad)
        self.type_var = tk.StringVar(value=TYPE_SUBJECT)
        type_frame = tk.Frame(self, bg=BG)
        type_frame.grid(row=3, column=0, sticky="w", **pad)
        for t in TYPES:
            tk.Radiobutton(type_frame, text=t, value=t, variable=self.type_var,
                           bg=BG, fg=TEXT, selectcolor=CARD, activebackground=BG,
                           font=("Segoe UI", 10)).pack(side="left", padx=(0, 12))

        tk.Label(self, text="Notes (optional)", bg=BG, fg=TEXT_DIM,
                 font=("Segoe UI", 9)).grid(row=4, column=0, sticky="w", **pad)
        self.notes = tk.Text(self, height=3, width=32, bg=CARD_ALT, fg=TEXT,
                             insertbackground=TEXT, relief="flat",
                             font=("Segoe UI", 10))
        self.notes.grid(row=5, column=0, sticky="ew", **pad)

        btns = tk.Frame(self, bg=BG)
        btns.grid(row=6, column=0, sticky="e", pady=(6, 10), padx=12)
        _button(btns, "Cancel", self.destroy, bg=CARD).pack(side="right", padx=(6, 0))
        _button(btns, "Create", self._create, bg=ACCENT, fg="#000000").pack(side="right")

        self.grab_set()
        entry.focus_set()

    def _create(self) -> None:
        try:
            name = validate_name(self.name_var.get())
        except ValueError as exc:
            messagebox.showerror("Invalid name", str(exc), parent=self)
            return
        if self.app.store.exists(name):
            messagebox.showerror("Exists", f"Profile '{name}' already exists.",
                                 parent=self)
            return
        try:
            self.app.store.create(name, type=self.type_var.get(),
                                  notes=self.notes.get("1.0", "end").strip())
        except Exception as exc:
            messagebox.showerror("Create failed", str(exc), parent=self)
            return
        self.destroy()
        self.app.switch_profile(name)


# =================================================================== app


class App(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title("Factum")
        self.geometry(str(CONFIG.get("window_geometry")))
        # Below this the tabs themselves stop fitting; the
        # ScrollHosts handle everything above it.
        self.minsize(900, 560)
        self.configure(bg=BG)

        self.store = ProfileStore()
        self.profile: Optional[Profile] = None
        self._quality = quality.QualityMonitor()
        # Drift checks only mean anything at rest; a contraction is
        # supposed to raise the level.
        self._recording_in_progress = False

        style = ttk.Style(self)
        style.theme_use("clam")
        style.configure("TNotebook", background=BG, borderwidth=0)
        style.configure("TNotebook.Tab", background=CARD, foreground=TEXT_DIM,
                        padding=(14, 7), font=("Segoe UI", 10))
        style.map("TNotebook.Tab", background=[("selected", CARD_ALT)],
                  foreground=[("selected", PRIMARY)])
        # -- combobox: the closed field.
        # `clam` renders a readonly combobox with a light grey field and
        # keeps the text "selected", so white-on-grey is what you get
        # unless every state is pinned explicitly. Hence the style.map:
        # readonly, focus, hover and disabled each need saying.
        style.configure("TCombobox", fieldbackground=CARD_ALT, background=CARD_ALT,
                        foreground=TEXT, arrowcolor=PRIMARY,
                        selectbackground=CARD_ALT, selectforeground=TEXT,
                        bordercolor=CARD, lightcolor=CARD_ALT, darkcolor=CARD_ALT,
                        insertcolor=TEXT, padding=4)
        style.map(
            "TCombobox",
            fieldbackground=[("readonly", CARD_ALT), ("disabled", CARD),
                             ("focus", CARD_ALT), ("!disabled", CARD_ALT)],
            foreground=[("readonly", TEXT), ("disabled", TEXT_DIM),
                        ("focus", TEXT), ("!disabled", TEXT)],
            selectbackground=[("readonly", CARD_ALT), ("focus", CARD_ALT),
                              ("!disabled", CARD_ALT)],
            selectforeground=[("readonly", TEXT), ("focus", TEXT),
                              ("!disabled", TEXT)],
            background=[("readonly", CARD_ALT), ("active", CARD),
                        ("!disabled", CARD_ALT)],
            arrowcolor=[("disabled", TEXT_DIM), ("!disabled", PRIMARY)],
            bordercolor=[("focus", PRIMARY), ("!focus", CARD)],
        )

        # -- combobox: the drop-down list.
        # That popup is a plain Tk Listbox living in its own toplevel, so
        # no ttk style reaches it — it has to be set through the option
        # database, and it has to be set before any popup is built.
        for widget in ("TCombobox", "ComboboxPopdownFrame"):
            self.option_add(f"*{widget}*Listbox.background", CARD_ALT)
            self.option_add(f"*{widget}*Listbox.foreground", TEXT)
            self.option_add(f"*{widget}*Listbox.selectBackground", ACCENT)
            self.option_add(f"*{widget}*Listbox.selectForeground", "#000000")
            self.option_add(f"*{widget}*Listbox.font", ("Segoe UI", 10))
            self.option_add(f"*{widget}*Listbox.borderWidth", 0)
            self.option_add(f"*{widget}*Listbox.highlightThickness", 0)
        # Catch-all for any listbox popup the patterns above miss.
        self.option_add("*Listbox.background", CARD_ALT)
        self.option_add("*Listbox.foreground", TEXT)
        self.option_add("*Listbox.selectBackground", ACCENT)
        self.option_add("*Listbox.selectForeground", "#000000")

        # -- other themed widgets, for the same readability reason
        style.configure("TScrollbar", background=CARD, troughcolor=BG,
                        bordercolor=BG, arrowcolor=TEXT_DIM, relief="flat")
        style.map("TScrollbar", background=[("active", CARD_ALT)])
        style.configure("TProgressbar", background=ACCENT, troughcolor=CARD_ALT,
                        bordercolor=CARD, lightcolor=ACCENT, darkcolor=ACCENT)
        style.configure("Treeview", background=CARD_ALT, fieldbackground=CARD_ALT,
                        foreground=TEXT, rowheight=24, borderwidth=0)
        style.configure("Treeview.Heading", background=CARD, foreground=TEXT_DIM,
                        relief="flat", font=("Segoe UI", 9))
        style.map("Treeview", background=[("selected", "#1e3a3a")],
                  foreground=[("selected", PRIMARY)])

        # Transport chatter lands in a deque rather than a widget: the
        # BLE callbacks arrive on their own thread and tkinter is not
        # thread-safe.
        from collections import deque as _deque
        self._log_lines: Any = _deque(maxlen=500)

        # Which transport is chosen once, here, and the answer is shown
        # in the Band tab rather than buried — when signal is missing,
        # "what am I even connected through?" is the first useful
        # question. Default is Bluetooth straight to the band; Mudra
        # Link is the fallback, not the foundation.
        import transport as transport_mod
        self.client, self.transport_used, self.transport_note = \
            transport_mod.create(on_log=lambda m: self.log_line(m))
        self.client.start()

        outer = tk.Frame(self, bg=BG, padx=12, pady=12)
        outer.pack(fill="both", expand=True)

        self.header = HeaderBar(outer, self)
        self.header.pack(fill="x", pady=(0, 6))
        self.banner = Banner(outer, self)
        self.banner.pack(fill="x", pady=(0, 6))

        self.notebook = ttk.Notebook(outer)
        self.notebook.pack(fill="both", expand=True)

        # Every tab lives inside a ScrollHost so a windowed Factum can
        # reach content that falls below the fold. `self._hosts` maps a
        # tab to the host the notebook actually holds, because
        # notebook.add() needs the host, not the tab.
        self._hosts: Dict[Any, ScrollHost] = {}

        def _tab(cls):
            host = ScrollHost(self.notebook)
            widget = cls(host.inner, self)
            widget.pack(fill="both", expand=True)
            self._hosts[widget] = host
            return widget

        self.session_tab = _tab(SessionTab)
        self.band_tab = _tab(BandTab)
        self.log_tab = _tab(LogTab)
        self.contact_tab = _tab(ContactTab)
        self.trigger_tab = _tab(TriggerTab)
        self.tuning_tab = _tab(TuningTab)
        self.assistant_tab = _tab(AssistantTab)
        self.profile_tab = _tab(ProfileTab)
        self._placeholders = [
            (self._placeholder("Switch mode",
                               "Single-signal scanning mode for everyday use."),
             "  Switch mode  "),
        ]

        self.apply_advanced_mode()
        self.protocol("WM_DELETE_WINDOW", self._on_close)
        self.bind("<Control-n>", lambda _e: self.header.add_quick_note())
        # Esc always disarms live output, from any tab. A safety control
        # that only works on one screen is not a safety control.
        self.bind("<Escape>", lambda _e: self.trigger_tab.panic())

        # Title screen, then the app. The profile boot waits for the
        # splash to clear so a "create a profile" prompt can never open
        # behind it.
        self.mini: Optional[MiniWindow] = None
        self.everyday_mode = "--run" in sys.argv[1:]

        # A threshold that was silently corrected on this launch has to
        # be said out loud. Someone who tuned a value by hand deserves
        # to know it was overruled, and someone who did not deserves to
        # know the numbers on screen changed since last time.
        retired = getattr(CONFIG, "retired", {}) or {}
        if retired:
            changed = ", ".join(f"{k} {v} → {CONFIG.get(k)}"
                                for k, v in sorted(retired.items()))
            self.after(2500, lambda: self.flash(
                f"Updated measured thresholds: {changed}. The old values "
                f"predate the measurements that corrected them.", 12.0))

        splash_seconds = float(CONFIG.get("splash_seconds"))
        if self.everyday_mode:
            # Everyday mode: no splash, no main window, straight to the
            # panel. The person this runs for cannot dismiss a dialog.
            self.after(50, self._boot_everyday)
        elif splash_seconds > 0:
            self.withdraw()
            SplashScreen(self, splash_seconds, self._after_splash)
        else:
            self.after(150, self._boot_profile)

    def _boot_everyday(self) -> None:
        """Boot straight into detection with no setup UI."""
        import everyday

        self.withdraw()
        self._boot_profile()
        result = everyday.ensure_host()
        self.mini = MiniWindow(self)
        if not result.get("ok"):
            self.mini.detail.configure(text=result.get("message", ""))
        # The detector only runs while the Trigger tab is mapped, which
        # it never is in everyday mode — so drive it from here instead.
        self.after(200, self._everyday_pump)

    def _everyday_pump(self) -> None:
        try:
            self.trigger_tab._ensure()
            self.trigger_tab._pump()
        except Exception:
            pass
        self.after(100, self._everyday_pump)

    def _after_splash(self) -> None:
        self.deiconify()
        self.lift()
        self.focus_force()
        self.after(100, self._boot_profile)

    def _placeholder(self, title: str, blurb: str) -> tk.Frame:
        f = tk.Frame(self.notebook, bg=BG, padx=24, pady=24)
        tk.Label(f, text=title, bg=BG, fg=PRIMARY,
                 font=("Segoe UI Semibold", 13)).pack(anchor="w")
        tk.Label(f, text=blurb + "\n\nNot built yet.", bg=BG, fg=TEXT_DIM,
                 font=("Segoe UI", 10), justify="left",
                 wraplength=700).pack(anchor="w", pady=(6, 0))
        return f

    # ----------------------------------------------------- advanced mode

    def apply_advanced_mode(self) -> None:
        """Simple mode is two tabs. Advanced adds the rest."""
        for tab in self.notebook.tabs():
            self.notebook.forget(tab)
        self.notebook.add(self._hosts[self.session_tab], text="  Session  ")
        # Band is a simple-mode tab. Pairing is not an advanced topic —
        # it is the first thing that has to work, and when it does not,
        # burying it behind a toggle strands the person in the room.
        self.notebook.add(self._hosts[self.band_tab], text="  Band  ")
        self.notebook.add(self._hosts[self.trigger_tab], text="  Trigger  ")
        if self.header.advanced_var.get():
            self.notebook.add(self._hosts[self.contact_tab], text="  Contact & Placement  ")
            self.notebook.add(self._hosts[self.tuning_tab], text="  Tuning  ")
            self.notebook.add(self._hosts[self.assistant_tab], text="  AI assistant  ")
            self.notebook.add(self._hosts[self.profile_tab], text="  Profile  ")
            for frame, label in self._placeholders:
                self.notebook.add(frame, text=label)
        self.notebook.add(self._hosts[self.log_tab], text="  Log  ")

    # --------------------------------------------------------- shortcuts

    def session(self, create: bool = True) -> Optional[Session]:
        if self.profile is None:
            return None
        return self.profile.session(self.profile.active_arm, create=create,
                                    battery_pct=self._battery(),
                                    on_charger=self._charging())

    def open_session(self) -> Optional[Session]:
        if self.profile is None:
            return None
        return self.profile.open_session(self.profile.active_arm)

    def _battery(self) -> Optional[int]:
        batt = self.client.device.get("battery")
        return int(batt) if isinstance(batt, (int, float)) else None

    def _charging(self) -> Optional[bool]:
        val = self.client.device.get("charging")
        return bool(val) if val is not None else None

    def flash(self, message: str, seconds: float = 4.0) -> None:
        self.banner.flash(message, seconds)

    def log_line(self, message: str) -> None:
        """Append to the in-memory transport log.

        Called from BLE callback threads, so it must not touch a widget
        — it only appends to a deque, and the tabs render it on their
        own timers. Tkinter is not thread-safe and a BLE disconnect
        arriving mid-redraw would otherwise crash the app.
        """
        stamp = time.strftime("%H:%M:%S")
        self._log_lines.append(f"{stamp}  {message}")

    def log_text(self, limit: int = 200) -> str:
        return "\n".join(list(self._log_lines)[-limit:])

    def quality_now(self) -> Optional[Dict[str, Any]]:
        """Rolling signal-quality assessment, updated at most once a second.

        Runs off the same ring buffer everything else uses, so it costs
        one FFT a second and nothing else.
        """
        import calibrate

        window = self.client.snapshot(2.0)
        if window.shape[1] < 256:
            return None
        cal = {}
        if self.profile is not None:
            cal = calibrate.load(self.profile, self.profile.active_arm)
        # "At rest" is inferred rather than asked: if no recording is in
        # progress, whatever the arm is doing is the resting condition.
        return self._quality.update(
            window, int(self.client.samples_per_second() or _fallback_fs()),
            calibration=cal, at_rest=not self._recording_in_progress)

    # ---------------------------------------------------------- profile

    def _boot_profile(self) -> None:
        last = self.store.last_used()
        if last is None:
            if not self.store.list_profiles():
                messagebox.showinfo(
                    "Create a profile",
                    "Every recording is filed under a profile. Create one to "
                    "continue.")
                NewProfileDialog(self.header, self)
                return
            return
        try:
            self._activate_profile(self.store.load(last))
        except Exception:
            NewProfileDialog(self.header, self)

    def switch_profile(self, name: str) -> None:
        if self.profile is not None and self.profile.any_session_open():
            if not messagebox.askyesno(
                "Switch profile?",
                f"Profile '{self.profile.name}' still has an open session.\n"
                f"Close and analyse it, then switch to '{name}'?",
            ):
                self.header.profile_var.set(self.profile.name)
                return
            for arm in ARMS:
                if self.profile.has_open_session(arm):
                    self.profile.close_session(arm)
        try:
            self._activate_profile(self.store.load(name))
        except Exception as exc:
            messagebox.showerror("Load failed", str(exc))

    def _activate_profile(self, prof: Profile) -> None:
        self.profile = prof
        # Auto-switch to a PLACEABLE arm on load. Opening a profile
        # on an arm where the band cannot be placed makes the whole
        # panel read as broken; if any other arm is placeable, prefer
        # it. Only if no arm is placeable do we stay put and let the
        # explanatory state render.
        current_limb = prof.limb(prof.active_arm)
        if not current_limb.has_forearm:
            for arm in ARMS:
                if prof.limb(arm).has_forearm:
                    prof.active_arm = arm
                    prof.save()
                    break
        self.store.set_last_used(prof.name)
        self.title(f"Factum — {prof.name} ({prof.type})")
        self.on_context_changed()

    def on_context_changed(self) -> None:
        """Profile or arm changed — every view rebuilds from disk."""
        self.header.refresh()
        self.session_tab.on_context_changed()
        self.profile_tab.refresh()
        # The limb diagram is arm-specific — switching arms must redraw
        # it, or someone ends up placing a band against the wrong limb.
        try:
            self.contact_tab.refresh_limb()
        except Exception:
            pass

    # ------------------------------------------------- closing a session

    def close_session_with_progress(self, arm: str) -> None:
        """Close and analyse without freezing the UI or losing the result."""
        if self.profile is None:
            return
        prof = self.profile
        sess = prof.open_session(arm)
        if sess is None:
            return

        dialog = tk.Toplevel(self)
        dialog.title("Analysing session")
        dialog.configure(bg=BG)
        dialog.transient(self)
        dialog.resizable(False, False)
        dialog.geometry("360x120+%d+%d" % (self.winfo_rootx() + 340,
                                           self.winfo_rooty() + 240))
        tk.Label(dialog, text="Analysing the session…", bg=BG, fg=PRIMARY,
                 font=("Segoe UI Semibold", 12)).pack(pady=(24, 6))
        tk.Label(dialog, text="Writing REPORT.md and analysis.json", bg=BG,
                 fg=TEXT_DIM, font=("Segoe UI", 9)).pack()
        bar = ttk.Progressbar(dialog, mode="indeterminate", length=280)
        bar.pack(pady=12)
        bar.start(12)
        dialog.grab_set()

        result: Dict[str, Any] = {}

        def work() -> None:
            try:
                result["session"] = prof.close_session(arm, analyse=True)
            except Exception as exc:
                result["error"] = exc

        thread = threading.Thread(target=work, daemon=True)
        thread.start()

        def poll() -> None:
            if thread.is_alive():
                self.after(150, poll)
                return
            bar.stop()
            dialog.destroy()
            self.on_context_changed()
            if result.get("error"):
                messagebox.showerror("Analysis failed",
                                     f"The session was closed, but analysis "
                                     f"failed:\n{result['error']}")
                return
            closed = result.get("session")
            if closed is not None and os.path.exists(closed.report_md):
                if messagebox.askyesno(
                    "Session closed",
                    f"{closed.stamp} closed and analysed.\n\nOpen the report?",
                ):
                    _reveal(closed.report_md)
            else:
                self.flash("Session closed.")

        self.after(150, poll)

    # ------------------------------------------------------------ lifecycle

    def shutdown(self, restart: bool = False) -> None:
        """Close cleanly, optionally relaunching afterwards."""
        self._restart_after_close = restart
        self._on_close()

    def _relaunch(self) -> None:
        """Start a fresh Factum through the launcher, then let this one die.

        Goes via run.bat rather than re-exec'ing Python so the restart
        takes the same path as a normal launch — same venv, same
        environment scrubbing, same log.
        """
        import subprocess

        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        launcher = os.path.join(root, "run.bat")
        try:
            if os.path.exists(launcher):
                subprocess.Popen(["cmd.exe", "/c", launcher],
                                 cwd=root, close_fds=True,
                                 creationflags=getattr(subprocess,
                                                       "CREATE_NO_WINDOW", 0))
            else:
                subprocess.Popen([sys.executable,
                                  os.path.abspath(__file__)], cwd=root,
                                 close_fds=True)
        except Exception:
            pass

    def _on_close(self) -> None:
        try:
            if self.profile is not None and self.profile.any_session_open():
                # Analysis on close is automatic — but a hung analysis must
                # never stop the app from exiting, so it runs bounded.
                worker = threading.Thread(
                    target=lambda: [self.profile.close_session(arm)
                                    for arm in ARMS
                                    if self.profile.has_open_session(arm)],
                    daemon=True)
                worker.start()
                worker.join(timeout=20.0)
        except Exception:
            pass
        try:
            CONFIG.set("window_geometry", self.geometry())
            self.client.stop()
        finally:
            # Relaunch only after the client is stopped, so the host's
            # single WebSocket slot is genuinely free before the new
            # instance tries to claim it.
            if getattr(self, "_restart_after_close", False):
                self._relaunch()
            self.destroy()


if __name__ == "__main__":
    App().mainloop()
