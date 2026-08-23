"""The limb, drawn — so band placement is a position, not a sentence.

Placement was a free-text note: *"3 fingers below elbow, mark A"*. That
is better than nothing and worse than it looks. Whose fingers? Which
elbow landmark? And when the same session is repeated three weeks later
by a different helper, "mark A" means nothing at all.

Placement drift is not a minor annoyance here. Every consistency and
separability number compares recordings that are only comparable if the
electrodes sat in the same place. A band rotated 40 degrees puts the
ulnar electrode over the median group and produces a completely
different signal for an identical movement — which the analysis will
faithfully report as "the movement drifted".

So placement is recorded as two numbers against a drawn limb:

    distance_mm   from the elbow crease, along the limb
    rotation_deg  around the limb, 0 = ch1 over the ulnar border

and the drawing is the interface. Someone points at where the band is;
the app writes down where that is. No ruler, no shared vocabulary, no
trust in anyone's memory of "mark A".

Why drawn rather than photographed
----------------------------------
A photo shows one placement and needs a camera, a file, a filename and
somewhere for it to leak from. A drawing generalises, works offline,
weighs nothing, renders identically on any machine, and can carry the
electrode positions *live* on top of it. The app already refuses to
store anything but CSV and JSON; this keeps that promise.

Everything here is vector geometry over a tkinter Canvas — no image
files, no third-party toolkit, no assets to lose.

Kyle's anatomy (established 2026-08-09)
---------------------------------------
LEFT — amputated about an inch above the wrist bone, so the wrist bone
itself is gone. In clinical terms a long transradial residual limb.
Nearly the whole forearm is intact, which means the finger and wrist
muscle bellies are intact: this is a normal forearm band placement and
the arm the project should be built around.

RIGHT — amputated at the elbow. There is no forearm at all. A forearm
band has nowhere to sit. What remains is upper arm — biceps, triceps —
which is a different muscle set producing a different, coarser signal
with no finger-flexor content whatsoever.

This corrects an assumption written into the early plan: that two
residual limbs double the available vocabulary. They do not. There is
one forearm here, on the left. The right arm is a second input source
only in the crude sense that a biceps contraction is detectable — it
cannot produce anything resembling a finger movement.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

# Every anatomical / rotation / geometry value lives in one place —
# this module is a consumer, not a source. See placement_contract.py
# for the coordinate contract; nothing here may re-derive it.
from placement_contract import (
    PLACEMENT_CONVENTION_VERSION,
    PALM_CENTRE_DEG, DORSAL_CENTRE_DEG,
    ELECTRODE_ANATOMICAL_OFFSETS_DEG,
    BAND_RIGID_HALF_ARC_DEG, BAND_STRAP_HALF_ARC_DEG,
    BAND_WIDTH_MM, BAND_CLEARANCE_MM, SENSOR_SPACING_MM,
    ALIGNED_TOL_DEG, ROTATION_CLAMP_DEG,
    CHANNELS as CONTRACT_CHANNELS,
    CHANNEL_LEGEND,
    SOURCE_MEASURED, SOURCE_ESTIMATED, VALID_SOURCES,
    arm_screen_sign, anatomical_to_screen, screen_to_anatomical,
    anatomical_electrode_angles, anatomical_mark_angle,
    band_range_mm as contract_band_range_mm,
)

# --------------------------------------------------------- limb levels

TRANSRADIAL = "transradial"      # below the elbow — a forearm remains
TRANSHUMERAL = "transhumeral"    # at or above the elbow — no forearm
INTACT = "intact"                # a whole arm (the developer's own)
UNKNOWN = "unknown"              # anatomy not confirmed for this profile

LEVEL_NAMES = {
    TRANSRADIAL:  "Below elbow (forearm remains)",
    TRANSHUMERAL: "At or above elbow (no forearm)",
    INTACT:       "Intact arm",
    UNKNOWN:      "Anatomy not defined",
}

# Fraction of the residual limb below which the band would sit on
# elbow tendons rather than muscle belly. Above the physical clamps
# from placement_contract (BAND_WIDTH_MM/2 + clearance), whichever is
# larger, becomes the band's minimum distance.
BAND_MIN_FRACTION = 0.15

# Typical intact forearm, elbow crease to wrist crease. Used only to
# draw a sensible default when nobody has measured anything yet.
DEFAULT_FOREARM_MM = 260
DEFAULT_UPPERARM_MM = 300


@dataclass
class Limb:
    """One residual limb: what is left of it, and what fits on it."""

    arm: str                       # "left" | "right"
    level: str = INTACT
    residual_mm: int = DEFAULT_FOREARM_MM   # elbow crease to the end
    circumference_mm: int = 240
    note: str = ""
    # How the numbers above were obtained. MEASURED = caliper on the
    # actual person; ESTIMATED = guess pending measurement. Everything
    # downstream (diagram colour, CSV headers, reports) must honour it.
    measurement_source: str = SOURCE_MEASURED

    # --------------------------------------------------------- geometry

    @property
    def has_forearm(self) -> bool:
        return self.level in (TRANSRADIAL, INTACT) and self.residual_mm >= 60

    @property
    def band_range_mm(self) -> Tuple[int, int]:
        """The window along the limb where a forearm band's CENTRE can sit.

        Uses the contract's `contract_band_range_mm` for the physical
        clamp (band width + clearance), then widens the lower bound by
        the profile-level `BAND_MIN_FRACTION` (kept above tendon-only
        placements).
        """
        if not self.has_forearm:
            return (0, 0)
        lo_physical, hi_physical = contract_band_range_mm(self.residual_mm)
        if hi_physical == 0:
            return (0, 0)
        lo = max(lo_physical, int(self.residual_mm * BAND_MIN_FRACTION))
        return (lo, hi_physical)

    def default_distance_mm(self) -> int:
        lo, hi = self.band_range_mm
        if hi <= lo:
            return 0
        # A third of the way into the usable window: far enough from the
        # elbow to clear the tendons, near enough that the muscle bellies
        # are still thick underneath.
        return int(lo + (hi - lo) * 0.35)

    def fits(self, distance_mm: int) -> bool:
        lo, hi = self.band_range_mm
        return lo <= distance_mm <= hi and hi > lo

    # ---------------------------------------------------- what this means

    def headline(self) -> str:
        if self.level == UNKNOWN:
            return ("Anatomy not defined for this arm. Enter the "
                    "amputation level and residual length in the "
                    "profile's anatomy block before recording.")
        if self.level == TRANSHUMERAL:
            return ("No forearm segment on this side — the limb ends "
                    "at the elbow. A forearm band cannot be placed here.")
        # "(estimated)" only when a length is being reported.
        source_hint = (" (estimated)"
                       if (self.measurement_source == SOURCE_ESTIMATED
                           and self.residual_mm > 0)
                       else "")
        if self.level == TRANSRADIAL:
            lo, hi = self.band_range_mm
            return (f"Forearm residual limb, {self.residual_mm} mm"
                    f"{source_hint} from the elbow crease. "
                    f"Band fits between {lo} and {hi} mm.")
        return (f"Intact arm, forearm {self.residual_mm} mm"
                f"{source_hint}. Band fits between "
                f"{self.band_range_mm[0]} and {self.band_range_mm[1]} mm.")

    def caution(self) -> str:
        """What will go wrong here, said before it does."""
        if self.level == TRANSHUMERAL:
            return ("Anything recorded from this side comes from biceps and "
                    "triceps. Those muscles do not move fingers, so no "
                    "amount of training turns an upper-arm signal into a "
                    "finger movement. It can still work as a coarse, "
                    "separate switch — treat it as a second button, never "
                    "as a second hand.")
        if self.level == TRANSRADIAL and self.residual_mm < 140:
            return ("Short residual limb. There is little room to move the "
                    "band, so the same placement will be easy to repeat but "
                    "hard to improve on — and the band may sit over tendon "
                    "rather than muscle belly.")
        return ""

    # -------------------------------------------------------- persistence

    def to_dict(self) -> Dict[str, Any]:
        return {"arm": self.arm, "level": self.level,
                "residual_mm": self.residual_mm,
                "circumference_mm": self.circumference_mm,
                "note": self.note,
                "measurement_source": self.measurement_source}

    @classmethod
    def from_dict(cls, data: Dict[str, Any], arm: str = "") -> "Limb":
        data = data or {}
        # `level` defaults to UNKNOWN rather than INTACT — a missing
        # level must render as an explicit error state instead of
        # silently drawing a hand.
        source = str(data.get("measurement_source", SOURCE_MEASURED))
        if source not in VALID_SOURCES:
            source = SOURCE_MEASURED
        return cls(arm=data.get("arm") or arm or "right",
                   level=data.get("level", UNKNOWN),
                   residual_mm=int(data.get("residual_mm", 0)),
                   circumference_mm=int(data.get("circumference_mm", 240)),
                   note=data.get("note", ""),
                   measurement_source=source)


def default_limbs(profile_type: str = "subject") -> Dict[str, "Limb"]:
    """What to assume about a new profile's arms.

    A **debug** profile is the developer testing on their own arm — it
    is safe (and correct) to assume intact anatomy there. Everything
    else defaults to UNKNOWN: the app must not silently draw a hand
    on an amputated limb because someone forgot to fill in the
    anatomy block. The diagram will render an explicit
    "No anatomy defined" state and refuse to place a band until real
    measurements are recorded.
    """
    if profile_type == "debug":
        return {arm: Limb(arm=arm, level=INTACT,
                          note="Developer's own arm — debug profile.")
                for arm in ("left", "right")}
    return {arm: Limb(arm=arm, level=UNKNOWN, residual_mm=0,
                      note="Anatomy not confirmed — measure and enter.")
            for arm in ("left", "right")}


# Kyle, as established 2026-08-09. Offered when a subject profile is
# created so nobody has to remember the numbers; always editable
# afterwards.
KYLE_LIMBS = {
    "left": Limb("left", TRANSRADIAL, residual_mm=230,
                 note="Amputated about an inch above the wrist bone; the "
                      "wrist bone is gone. Long transradial — nearly the "
                      "whole forearm, so the finger and wrist muscle "
                      "bellies are intact. This is the working arm."),
    "right": Limb("right", TRANSHUMERAL, residual_mm=0,
                  note="Amputated at the elbow. No forearm. A forearm band "
                       "cannot be placed; only upper-arm muscle is "
                       "available, which carries no finger content."),
}


# ------------------------------------------------------------- placement


# The three electrodes, in the order the band reports them. Named by
# the nerve trunk they sit over on the volar (palm) side. ch1 always
# sits over the ulnar (pinky) side, ch3 over the radial (thumb) side;
# the SCREEN order flips between left and right arms because the
# cross-section is viewed from the distal end looking toward the elbow.
ELECTRODES = CONTRACT_CHANNELS

# Cross-section convention: viewed from the DISTAL end (the hand)
# looking toward the elbow, with the palm DOWN (forearm pronated). In
# canvas polar coordinates the palm side is at 270 deg (bottom of the
# drawing) and the dorsal side is at 90 deg (top).
# PALM_CENTRE_DEG / DORSAL_CENTRE_DEG imported from placement_contract.

# Sensor offsets stated in ANATOMICAL space: negative = toward the
# ulnar (pinky) side, positive = toward the radial (thumb) side. This
# is arm-independent; screen positions are derived by multiplying by
# `arm_screen_sign(arm)` so ch1 always renders on the pinky side of
# the diagram regardless of which arm is being drawn. ~6 mm arc on a
# 240 mm circumference works out to ~9 deg per step.
# ELECTRODE_ANATOMICAL_OFFSETS_DEG imported from placement_contract.

# Real-band geometry. The rigid housing wraps ~200 deg across the palm
# side; the fabric velcro strap covers the remaining ~160 deg across
# the dorsal side. Sensors sit inside the housing, contacting skin.
# BAND_RIGID_HALF_ARC_DEG, BAND_STRAP_HALF_ARC_DEG, ALIGNED_TOL_DEG,
# ROTATION_CLAMP_DEG, and arm_screen_sign() all imported at the top
# of this module from placement_contract.


@dataclass
class Placement:
    """Where the band is, as numbers rather than a sentence."""

    arm: str = "right"
    distance_mm: int = 0        # from the elbow crease, along the limb
    # Offset of the band's black centring mark from the forearm midline,
    # in degrees, in ANATOMICAL space: 0 = mark aligned with palm
    # centre; positive = mark rotated toward the thumb (radial) side;
    # negative = toward the pinky (ulnar) side. Arm-independent — the
    # rendering mirrors it per arm at draw time. Clamped to +/-90 deg
    # by the drag handler; anything past a quarter turn is nonsense.
    rotation_deg: int = 0
    on_upper_arm: bool = False  # true when there is no forearm to use
    note: str = ""

    def electrode_angles(self) -> List[float]:
        """Screen polar angles for each sensor pad.

        Delegates to `placement_contract.anatomical_electrode_angles`
        — this file must not derive the mapping itself. Result order
        matches CHANNELS: ch1/ch2/ch3 = ulnar/median/radial.
        """
        return list(anatomical_electrode_angles(self.rotation_deg, self.arm))

    def mark_angle(self) -> float:
        """Screen polar angle of the strap's black centring line."""
        return anatomical_mark_angle(self.rotation_deg, self.arm)

    def aligned(self) -> bool:
        return abs(self.rotation_deg) <= ALIGNED_TOL_DEG

    def describe(self) -> str:
        """The canonical string stamped into every probe's CSV header."""
        where = "upper arm" if self.on_upper_arm else "forearm"
        bits = [f"{self.arm} {where}",
                f"{self.distance_mm}mm from elbow",
                f"rotated {self.rotation_deg} deg"]
        if self.note:
            bits.append(self.note)
        return "; ".join(bits)

    def matches(self, other: Optional["Placement"],
                distance_tol_mm: int = 10,
                rotation_tol_deg: int = 15) -> bool:
        """Close enough that two sessions are comparable.

        The tolerances are deliberately tight. 15 degrees of rotation on
        a 240 mm circumference moves an electrode 10 mm around the limb,
        which is most of the way to the next muscle group.
        """
        if other is None:
            return False
        return (self.arm == other.arm
                and self.on_upper_arm == other.on_upper_arm
                and abs(self.distance_mm - other.distance_mm) <= distance_tol_mm
                and _angle_gap(self.rotation_deg,
                               other.rotation_deg) <= rotation_tol_deg)

    def drift_from(self, other: Optional["Placement"]) -> str:
        """Plain words for how far this has moved from a previous placement."""
        if other is None:
            return ""
        if self.matches(other):
            return "Same placement as last time — recordings are comparable."
        parts = []
        d = self.distance_mm - other.distance_mm
        if abs(d) > 3:
            parts.append(f"{abs(d)} mm {'further out' if d > 0 else 'closer to the elbow'}")
        r = _angle_gap(self.rotation_deg, other.rotation_deg)
        if r > 3:
            parts.append(f"rotated {r} deg")
        if not parts:
            return "Same placement as last time — recordings are comparable."
        return ("Band has moved since last time: " + ", ".join(parts)
                + ". Expect the same movement to look different; that is "
                  "the placement, not him.")

    def to_dict(self) -> Dict[str, Any]:
        return {"arm": self.arm, "distance_mm": self.distance_mm,
                "rotation_deg": self.rotation_deg,
                "on_upper_arm": self.on_upper_arm, "note": self.note}

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Placement":
        data = data or {}
        return cls(arm=data.get("arm", "right"),
                   distance_mm=int(data.get("distance_mm", 0)),
                   rotation_deg=int(data.get("rotation_deg", 0)),
                   on_upper_arm=bool(data.get("on_upper_arm", False)),
                   note=data.get("note", ""))


def _angle_gap(a: float, b: float) -> int:
    """Smallest angle between two bearings, 0-180."""
    return int(round(abs((a - b + 180) % 360 - 180)))


# =========================================================== the drawing


# Fixed diagram size — a measurement instrument must not resize with
# the window. Sized to fit a typical Contact & Placement tab at a
# 1280 px window without a horizontal scrollbar.
DIAGRAM_W = 780
DIAGRAM_H = 460

# Fixed panel-band layout. Nothing crosses these boundaries.
PANEL_TITLE_H = 44          # two lines
PANEL_HINT_H  = 50          # sensor legend + drag hint stack here
PANEL_PAD = 8

# Per-panel gutter widths. Panel 1 (longitudinal) uses a wide LEFT
# gutter for landmark labels ("0 mm — elbow crease") and a narrow
# RIGHT gutter because the ALIGNED/distance badge is drawn INLINE
# next to the band. Panel 2 (cross-section) is symmetric because
# thumb / pinky labels live in both gutters.
P1_LEFT_GUTTER  = 140
P1_RIGHT_GUTTER = 28
P2_LEFT_GUTTER  = 96
P2_RIGHT_GUTTER = 96

# Reserved space at the top of the longitudinal drawing band for the
# hand. The forearm polygon starts BELOW this line so the hand can
# never spill into the title.
HAND_RESERVE_H = 92

# Real Mudra Band colours — the housing is dark plastic, the strap is
# a lighter woven grey, contacts are gold, LED is blue.
BAND_HOUSING_FILL = "#1f2937"
BAND_HOUSING_EDGE = "#334155"
BAND_HOUSING_HL   = "#4b5563"
BAND_STRAP_FILL   = "#94a3b8"
BAND_STRAP_EDGE   = "#64748b"
BAND_CONTACT_GOLD = "#d4af37"
BAND_LED_BLUE     = "#38bdf8"


# Drawn with the same palette as the app so the diagram does not look
# like a screenshot from somewhere else. Passed in rather than imported
# to keep this module free of any dependency on the UI.
@dataclass
class Palette:
    bg: str = "#0f172a"
    skin: str = "#334155"
    skin_edge: str = "#64748b"
    bone: str = "#475569"
    band: str = "#22d3ee"
    band_dim: str = "#155e75"
    text: str = "#e2e8f0"
    dim: str = "#94a3b8"
    warn: str = "#fbbf24"
    bad: str = "#f87171"
    ok: str = "#4ade80"
    electrode: Tuple[str, str, str] = ("#f472b6", "#facc15", "#60a5fa")


class LimbDiagram:
    """Draws a limb on a tkinter Canvas and lets someone point at it.

    Two panels, side by side, each with a fixed three-band layout
    (title / drawing / hint) and horizontal gutters inside the drawing
    band that hold labels. Nothing crosses a band boundary; nothing
    from the artwork region enters a gutter. This makes the layout
    predictable and clip-free regardless of canvas size.

      LONGITUDINAL   the limb from elbow (top) down to the distal end
                     (bottom), with the band as a horizontal cuff you
                     drag up and down. Answers "how far from the elbow?"
      CROSS-SECTION  viewed from the DISTAL end looking toward the
                     elbow, palm down. Shows the real band shape —
                     rigid housing on the palm side, fabric strap
                     across the dorsal side. Drag around the section
                     to rotate the black centring mark from midline.
    """

    def __init__(self, canvas, limb: Limb, placement: Placement,
                 palette: Optional[Palette] = None,
                 on_change=None,
                 profile_name: str = "") -> None:
        self.canvas = canvas
        self.limb = limb
        self.placement = placement
        self.p = palette or Palette()
        self.on_change = on_change
        self.profile_name = profile_name
        self._drag: Optional[str] = None

        canvas.bind("<Button-1>", self._on_press)
        canvas.bind("<B1-Motion>", self._on_drag)
        canvas.bind("<ButtonRelease-1>", lambda _e: setattr(self, "_drag", None))
        canvas.bind("<Configure>", lambda _e: self.redraw())

    # -------------------------------------------------------- layout maths
    #
    # The arm is drawn VERTICALLY, HAND at the TOP and the ELBOW at the
    # BOTTOM. This matches looking down at an outstretched arm from
    # above with palm down (dorsal surface facing the viewer): the elbow
    # is near your body (bottom of the panel) and the hand is at the
    # far end (top of the panel). Distance from the elbow grows UPWARD
    # on screen — bigger number = closer to the hand.

    def _geometry(self) -> Dict[str, Any]:
        # Fixed dimensions. The diagram is a MEASUREMENT INSTRUMENT —
        # it must not scale with the window or the numbers a helper
        # reads off it change meaning between sessions. The canvas
        # widget is created at DIAGRAM_W x DIAGRAM_H and the outer
        # container is expected to scroll if narrower.
        w = DIAGRAM_W
        h = DIAGRAM_H
        # Panels split down the middle. Each panel is a self-contained
        # three-band stack with its own gutters.
        split = w * 0.5
        p1 = self._panel_layout(0, 0, split, h,
                                lg=P1_LEFT_GUTTER, rg=P1_RIGHT_GUTTER)
        p2 = self._panel_layout(split, 0, w - split, h,
                                lg=P2_LEFT_GUTTER, rg=P2_RIGHT_GUTTER)

        # Longitudinal artwork: reserve HAND_RESERVE_H at the TOP for
        # the hand (intact profiles) — the forearm polygon starts
        # below this line, so the hand can never extend past the top
        # edge of the drawing band. Small pad at the bottom for the
        # elbow-crease label.
        arm_pad_bot = 30.0
        arm_y_top = p1["draw_y0"] + HAND_RESERVE_H   # wrist / distal end
        arm_y_bot = p1["draw_y1"] - arm_pad_bot      # elbow crease
        arm_cx    = p1["artwork_cx"]
        # Elbow half-width, capped to the artwork width so the arm
        # cannot spill into a gutter no matter how wide the canvas.
        max_half = (p1["artwork_x1"] - p1["artwork_x0"]) * 0.4
        elbow_half = min(max_half, 48.0)
        p1.update({
            "arm_cx": arm_cx,
            "arm_y_top": arm_y_top,
            "arm_y_bot": arm_y_bot,
            "elbow_half": elbow_half,
        })

        # Cross-section: sized so the STRAP arc (which extends beyond
        # the skin circle by ~18 px) still clears the "dorsal" caption
        # above and the "volar" caption below, and the ALIGNED readout
        # below the palm caption still clears the sensor legend at the
        # bottom of the drawing band.
        top_label_h    = 26.0     # dorsal caption
        bottom_stack_h = 74.0     # volar caption + ALIGNED readout
        sec_top    = p2["draw_y0"] + top_label_h
        sec_bottom = p2["draw_y1"] - bottom_stack_h
        # Reduce by ~15% vs. the naive fit so labels are always clear.
        max_r_from_h = ((sec_bottom - sec_top) / 2 - 26) * 0.85
        max_r_from_w = ((p2["artwork_x1"] - p2["artwork_x0"]) / 2 - 30) * 0.85
        sec_r  = max(30.0, min(max_r_from_h, max_r_from_w))
        sec_cy = (sec_top + sec_bottom) / 2
        p2.update({
            "sec_cx": p2["artwork_cx"],
            "sec_cy": sec_cy,
            "sec_r": sec_r,
        })

        return {"w": w, "h": h, "split": split, "p1": p1, "p2": p2}

    def _panel_layout(self, x0: float, y0: float,
                      w: float, h: float,
                      lg: float = P2_LEFT_GUTTER,
                      rg: float = P2_RIGHT_GUTTER) -> Dict[str, float]:
        """Compute the fixed-band layout for one panel.

        lg / rg = left / right gutter widths. Different per panel:
        panel 1 has a wide left / narrow right; panel 2 is symmetric.
        """
        title_y0 = y0 + PANEL_PAD
        draw_y0  = title_y0 + PANEL_TITLE_H
        hint_y0  = y0 + h - PANEL_HINT_H - PANEL_PAD
        draw_y1  = hint_y0
        left_g_x1  = x0 + PANEL_PAD + lg
        right_g_x0 = x0 + w - PANEL_PAD - rg
        # Guard against very narrow panels — collapse gutters gracefully.
        if right_g_x0 < left_g_x1 + 80:
            mid = x0 + w / 2
            left_g_x1  = mid - 40
            right_g_x0 = mid + 40
        artwork_cx = (left_g_x1 + right_g_x0) / 2
        return {
            "x0": x0, "x1": x0 + w, "w": w, "h": h,
            "title_y": title_y0, "title_cx": x0 + w / 2,
            "draw_y0": draw_y0, "draw_y1": draw_y1,
            "hint_y": hint_y0 + PANEL_HINT_H / 2,
            "left_g_x0": x0 + PANEL_PAD,
            "left_g_x1": left_g_x1,
            "right_g_x0": right_g_x0,
            "right_g_x1": x0 + w - PANEL_PAD,
            "artwork_x0": left_g_x1,
            "artwork_x1": right_g_x0,
            "artwork_cx": artwork_cx,
        }

    def _y_for_mm(self, g: Dict[str, Any], mm: float) -> float:
        """Vertical mapping: 0 mm = elbow (BOTTOM); residual_mm = end (TOP).

        Bigger distance from the elbow → higher up on screen.
        """
        p = g["p1"]
        span = max(self.limb.residual_mm, 1)
        frac = min(max(mm / span, 0.0), 1.0)
        return p["arm_y_bot"] - (p["arm_y_bot"] - p["arm_y_top"]) * frac

    def _mm_for_y(self, g: Dict[str, Any], y: float) -> int:
        p = g["p1"]
        span = max(p["arm_y_bot"] - p["arm_y_top"], 1.0)
        frac = min(max((p["arm_y_bot"] - y) / span, 0.0), 1.0)
        return int(round(frac * self.limb.residual_mm))

    def _half_at_mm(self, g: Dict[str, Any], mm: float) -> float:
        """Arm half-width at a given distance from the elbow — arm tapers."""
        p = g["p1"]
        span = max(self.limb.residual_mm, 1)
        frac = min(max(mm / span, 0.0), 1.0)
        # Kyle's transradial stump ends blunter (the wrist bone is gone),
        # so taper less aggressively; intact arms taper down to a wrist.
        taper_end = 0.78 if self.limb.level == TRANSRADIAL else 0.62
        return p["elbow_half"] * (1.0 - (1.0 - taper_end) * frac)

    # ------------------------------------------------------------ drawing

    def redraw(self) -> None:
        c = self.canvas
        c.delete("all")
        g = self._geometry()
        c.configure(bg=self.p.bg)
        self._draw_panel_titles(g)
        if self.limb.level == UNKNOWN:
            self._draw_unknown_anatomy(g)
        elif not self.limb.has_forearm:
            self._draw_no_forearm(g)
        else:
            self._draw_side(g)
            self._draw_section(g)
            self._draw_hints(g)
        # Regression assertion — log if any element leaves the canvas
        # or if any two text elements overlap, so a broken render is
        # visible in the logs instead of silently shipped.
        self._assert_layout(g)

    def _draw_panel_titles(self, g: Dict[str, Any]) -> None:
        """Panel 1 title carries profile + arm + level; panel 2 states view.

        ESTIMATED anatomy is rendered in the warning colour so it never
        reads as a measurement — consistent with the rule elsewhere in
        the project that a guess never looks like ground truth.
        """
        c, p = self.canvas, self.p
        prof = self.profile_name.upper() if self.profile_name else "PROFILE"
        # "(estimated)" only makes sense when the estimated NUMBER is
        # shown. On a transhumeral or unknown limb the length is zero
        # or absent by definition, so the flag would be meaningless.
        has_estimated_length = (
            self.limb.measurement_source == SOURCE_ESTIMATED
            and self.limb.level in (TRANSRADIAL, INTACT)
            and self.limb.residual_mm > 0)
        if self.limb.level == UNKNOWN:
            level_bit = "anatomy not defined"
        elif self.limb.level == TRANSRADIAL:
            level_bit = f"residual, {self.limb.residual_mm} mm"
        elif self.limb.level == TRANSHUMERAL:
            level_bit = "no forearm segment"
        elif self.limb.level == INTACT:
            level_bit = f"intact, {self.limb.residual_mm} mm"
        else:
            level_bit = self.limb.level
        if has_estimated_length:
            level_bit = level_bit + " (estimated)"
        estimated = has_estimated_length
        arm = self.limb.arm.upper()
        c.create_text(g["p1"]["title_cx"],
                      g["p1"]["title_y"] + 12,
                      text=prof, fill=p.text,
                      font=("Segoe UI Semibold", 11))
        subtitle_colour = (p.warn if estimated
                           else (p.bad if self.limb.level == UNKNOWN
                                 else p.dim))
        c.create_text(g["p1"]["title_cx"],
                      g["p1"]["title_y"] + 30,
                      text=f"{arm} arm  ·  {level_bit}",
                      fill=subtitle_colour, font=("Segoe UI", 9))

        c.create_text(g["p2"]["title_cx"],
                      g["p2"]["title_y"] + 12,
                      text="BAND ORIENTATION",
                      fill=p.text, font=("Segoe UI Semibold", 11))
        c.create_text(g["p2"]["title_cx"],
                      g["p2"]["title_y"] + 30,
                      text="viewed from the elbow, looking toward the hand",
                      fill=p.dim, font=("Segoe UI", 8))

    def _draw_hints(self, g: Dict[str, Any]) -> None:
        c, p = self.canvas, self.p
        c.create_text(g["p1"]["title_cx"], g["p1"]["hint_y"],
                      text="drag the band up or down to set distance",
                      fill=p.dim, font=("Segoe UI", 9))
        c.create_text(g["p2"]["title_cx"], g["p2"]["hint_y"],
                      text="drag around the cross-section to rotate the band",
                      fill=p.dim, font=("Segoe UI", 9))

    # -- side view -------------------------------------------------------

    def _draw_side(self, g: Dict[str, Any]) -> None:
        c, pal = self.canvas, self.p
        p1 = g["p1"]
        cx = p1["arm_cx"]
        y_top, y_bot = p1["arm_y_top"], p1["arm_y_bot"]

        # Distal end (hand or stump) at TOP, elbow at BOTTOM.
        elbow_half = self._half_at_mm(g, 0)
        end_half   = self._half_at_mm(g, self.limb.residual_mm)
        mid_mm  = self.limb.residual_mm * 0.45
        mid_half = self._half_at_mm(g, mid_mm) * 1.06
        mid_y = self._y_for_mm(g, mid_mm)

        # ONE continuous closed polygon for the limb. For an amputated
        # limb (transradial) the top ends in a smooth hemisphere with
        # no separate ellipse — no lump. For an intact arm the top
        # is a flat wrist; the palm (drawn next) overlaps the top,
        # covering the seam.
        pts: List[float] = [
            cx - elbow_half, y_bot,
            cx - mid_half,   mid_y,
            cx - end_half,   y_top,
        ]
        if self.limb.level == TRANSRADIAL:
            # Smooth hemisphere over the distal end, sampled fine
            # enough that Tk's smoothing doesn't visibly kink.
            for i in range(1, 12):
                theta = 180.0 - 180.0 * i / 12    # 180 → 0
                rad = math.radians(theta)
                pts.extend([cx + end_half * math.cos(rad),
                            y_top - end_half * math.sin(rad)])
        # Flat top for intact limbs — the palm overlaps it.
        pts.extend([
            cx + end_half,   y_top,
            cx + mid_half,   mid_y,
            cx + elbow_half, y_bot,
        ])
        c.create_polygon(pts, fill=pal.skin, outline=pal.skin_edge,
                         width=2, smooth=True)

        if self.limb.level == INTACT:
            # Palm overlaps the wrist so no visible seam. Hand size
            # capped inside HAND_RESERVE_H.
            self._draw_hand(g, cx, y_top, end_half)
            end_label = "wrist"
        else:
            end_label = "residual limb end"

        # Arm centreline — the forearm midline. The band's black mark
        # should sit ON this line when the band is aligned.
        c.create_line(cx, y_top, cx, y_bot,
                      fill=pal.dim, width=1, dash=(2, 4))

        # Elbow crease at the BOTTOM — the fixed landmark. Label sits in
        # the left gutter, right-aligned, ending flush at the gutter's
        # inner edge.
        c.create_line(cx - elbow_half - 10, y_bot,
                      cx + elbow_half + 10, y_bot,
                      fill=pal.dim, width=2, dash=(3, 3))
        c.create_text(p1["left_g_x1"] - 8, y_bot,
                      text="0 mm — elbow crease",
                      fill=pal.dim, font=("Segoe UI", 9),
                      anchor="e")

        # End-of-limb label at the TOP, in the left gutter.
        c.create_text(p1["left_g_x1"] - 8, y_top,
                      text=f"{end_label}\n{self.limb.residual_mm} mm",
                      fill=pal.dim, font=("Segoe UI", 9),
                      anchor="e", justify="right")

        # Usable-range track — a translucent shaded rectangle along the
        # arm showing where the band fits. Anchored to the arm outline.
        lo, hi = self.limb.band_range_mm
        ylo = self._y_for_mm(g, lo)
        yhi = self._y_for_mm(g, hi)
        y_lo_screen, y_hi_screen = min(ylo, yhi), max(ylo, yhi)
        strip_half = max(elbow_half, mid_half) + 6
        c.create_rectangle(cx - strip_half, y_lo_screen,
                           cx + strip_half, y_hi_screen,
                           outline=pal.band_dim, dash=(4, 3))
        # Range label in the LEFT gutter, sitting halfway down the strip,
        # right-aligned, well clear of the elbow-crease and end-of-limb
        # labels (guaranteed by the elbow being at top and end at bottom).
        c.create_text(p1["left_g_x1"] - 8, (y_lo_screen + y_hi_screen) / 2,
                      text=f"band fits\n{lo}–{hi} mm",
                      fill=pal.band_dim, font=("Segoe UI", 8),
                      anchor="e", justify="right")

        # The band — a cuff drawn as a filled rounded rectangle CLIPPED
        # to the arm width. It never extends past the limb silhouette
        # because the caller draws it inside the arm polygon width.
        by = self._y_for_mm(g, self.placement.distance_mm)
        arm_half_here = self._half_at_mm(g, self.placement.distance_mm) * 1.04
        band_thick = 12.0
        ok = self.limb.fits(self.placement.distance_mm)
        colour = pal.band if ok else pal.bad
        c.create_rectangle(cx - arm_half_here, by - band_thick / 2,
                           cx + arm_half_here, by + band_thick / 2,
                           fill=BAND_HOUSING_FILL, outline=colour, width=2,
                           tags="band")
        # Physical black centring mark, drawn ACROSS the band width
        # exactly on the arm midline. This is the same reference the
        # cross-section shows — the alignment view of the side.
        aligned = self.placement.aligned()
        mark_colour = pal.ok if aligned else pal.warn
        c.create_line(cx, by - band_thick / 2 - 2,
                      cx, by + band_thick / 2 + 2,
                      fill="#000000", width=3, tags="band")
        # Distance + ALIGNED/OFF-CENTRE badge sits ADJACENT to the band
        # so the reader's eye tracks the band as it moves — not
        # marooned in the right gutter with dead space between.
        rot = self.placement.rotation_deg
        arc_mm = _arc_mm(rot, self.limb.circumference_mm)
        badge = ("ALIGNED"
                 if aligned else
                 f"{'+' if rot > 0 else ''}{rot}°  "
                 f"({abs(arc_mm)} mm {_off_centre_side(rot)})")
        # Just outside the "band fits" range strip, so it never
        # overlaps the strip's dashed outline as the band moves.
        badge_x = cx + strip_half + 10
        c.create_text(badge_x, by,
                      text=(f"{self.placement.distance_mm} mm\n"
                            f"{badge}"),
                      fill=(pal.ok if aligned else pal.warn) if ok else pal.bad,
                      font=("Segoe UI Semibold", 9),
                      anchor="w", justify="left")

    # -- cross-section ---------------------------------------------------

    def _draw_section(self, g: Dict[str, Any]) -> None:
        """Cross-section, proximal → distal, palm down.

        Two-pass layout: first draw all artwork (arm, bones, band,
        sensors, contacts, LED, mark) tagged 'section-art'; then
        compute the actual bbox and place dorsal / volar / thumb /
        pinky labels relative to it. Labels can therefore never
        overlap the artwork by construction, regardless of how the
        band is rotated.
        """
        c, pal = self.canvas, self.p
        p2 = g["p2"]
        cx, cy, r = p2["sec_cx"], p2["sec_cy"], p2["sec_r"]
        s = arm_screen_sign(self.limb.arm)   # +1 left, -1 right
        rot = self.placement.rotation_deg
        screen_offset = s * rot
        housing_centre_deg = PALM_CENTRE_DEG + screen_offset
        strap_centre_deg   = DORSAL_CENTRE_DEG + screen_offset
        mark_deg           = strap_centre_deg
        aligned            = self.placement.aligned()
        mark_colour        = pal.ok if aligned else pal.warn

        # Radii chosen so the housing sits comfortably outside the arm
        # and the sensor pads sit ON the arm's inner face.
        band_r_inner  = r + 4
        band_r_outer  = r + 18
        strap_r_inner = r + 6
        strap_r_outer = r + 14

        ART = ("section-art",)
        # ---- arm cross-section ----
        c.create_oval(cx - r, cy - r, cx + r, cy + r,
                      fill=pal.skin, outline=pal.skin_edge, width=2,
                      tags=ART)
        # ---- bones ----
        radial_dx = s * r * 0.42
        ulnar_dx  = -radial_dx
        bone_cy   = cy - r * 0.35
        for dx in (ulnar_dx, radial_dx):
            c.create_oval(cx + dx - r * 0.17, bone_cy - r * 0.20,
                          cx + dx + r * 0.17, bone_cy + r * 0.20,
                          fill=pal.bone, outline="", tags=ART)
        # ---- rigid housing (~200 deg across palm side) ----
        housing_start  = housing_centre_deg - BAND_RIGID_HALF_ARC_DEG
        housing_extent = 2 * BAND_RIGID_HALF_ARC_DEG
        c.create_polygon(
            *_arc_ring_pts(cx, cy, band_r_inner, band_r_outer,
                           housing_start, housing_extent),
            fill=BAND_HOUSING_FILL, outline=BAND_HOUSING_EDGE, width=3,
            smooth=False, tags=ART)
        # ---- fabric strap (~160 deg across dorsal side) ----
        strap_start  = strap_centre_deg - BAND_STRAP_HALF_ARC_DEG
        strap_extent = 2 * BAND_STRAP_HALF_ARC_DEG
        c.create_polygon(
            *_arc_ring_pts(cx, cy, strap_r_inner, strap_r_outer,
                           strap_start, strap_extent),
            fill=BAND_STRAP_FILL, outline=BAND_STRAP_EDGE, width=1,
            smooth=False, tags=ART)
        for frac in (0.2, 0.5, 0.8):
            deg = strap_start + strap_extent * frac
            xi, yi = _polar(cx, cy, strap_r_inner + 1, deg)
            xo, yo = _polar(cx, cy, strap_r_outer - 1, deg)
            c.create_line(xi, yi, xo, yo,
                          fill=BAND_STRAP_EDGE, width=1, dash=(2, 2),
                          tags=ART)
        # ---- sensor pads: rounded rectangles on INNER surface ----
        angles = self.placement.electrode_angles()
        for i, angle in enumerate(angles):
            _draw_sensor_pad(c, cx, cy, r + 2, r + 10, angle,
                             halfwidth_deg=5.5,
                             fill=pal.electrode[i], outline=pal.bg,
                             tag_group=ART[0])
        # ---- charging contacts on OUTER surface ----
        contact_r        = band_r_outer + 5
        contact_axis_deg = housing_centre_deg + s * 60.0
        for k in range(5):
            spread = (k - 2) * 4.5
            deg = contact_axis_deg + spread
            xd, yd = _polar(cx, cy, contact_r, deg)
            c.create_oval(xd - 2.5, yd - 2.5, xd + 2.5, yd + 2.5,
                          fill=BAND_CONTACT_GOLD, outline="", tags=ART)
        # ---- LED on OUTER surface, opposite flank ----
        led_r   = band_r_outer + 5
        led_deg = housing_centre_deg - s * 65.0
        lx, ly = _polar(cx, cy, led_r, led_deg)
        c.create_oval(lx - 3, ly - 3, lx + 3, ly + 3,
                      fill=BAND_LED_BLUE, outline="", tags=ART)
        # ---- dashed arm midline (dorsal-to-palm reference) ----
        midline_top_x, midline_top_y = _polar(
            cx, cy, band_r_outer + 26, DORSAL_CENTRE_DEG)
        midline_bot_x, midline_bot_y = _polar(
            cx, cy, band_r_outer + 26, PALM_CENTRE_DEG)
        c.create_line(midline_top_x, midline_top_y,
                      midline_bot_x, midline_bot_y,
                      fill=pal.dim, width=1, dash=(2, 4), tags=ART)
        # ---- physical black mark on the STRAP ----
        mi_x, mi_y = _polar(cx, cy, strap_r_inner - 1, mark_deg)
        mo_x, mo_y = _polar(cx, cy, strap_r_outer + 5, mark_deg)
        c.create_line(mi_x, mi_y, mo_x, mo_y,
                      fill="#000000", width=5, tags=ART)
        c.create_line(mi_x, mi_y, mo_x, mo_y,
                      fill=mark_colour, width=1, tags=ART)

        # ---- Labels placed relative to actual artwork bbox ----
        art_bbox = c.bbox(ART[0]) or (cx - r, cy - r, cx + r, cy + r)
        art_x0, art_y0, art_x1, art_y1 = art_bbox

        # Dorsal caption ABOVE the artwork; volar caption BELOW.
        c.create_text(cx, art_y0 - 8,
                      text="DORSAL (back) — velcro strap",
                      fill=pal.dim, font=("Segoe UI", 8),
                      anchor="s")
        c.create_text(cx, art_y1 + 8,
                      text="VOLAR (palm) — sensors touch here",
                      fill=pal.dim, font=("Segoe UI", 8),
                      anchor="n")

        # Thumb / pinky labels in the OUTER gutters, on the correct
        # side per contract. LEFT arm → thumb on screen right.
        thumb_on_right = (s > 0)
        c.create_text(p2["right_g_x0"] + 6 if thumb_on_right
                      else p2["left_g_x1"] - 6,
                      cy,
                      text="thumb\n(radial)", fill=pal.dim,
                      font=("Segoe UI", 8),
                      anchor="w" if thumb_on_right else "e",
                      justify="left" if thumb_on_right else "right")
        c.create_text(p2["left_g_x1"] - 6 if thumb_on_right
                      else p2["right_g_x0"] + 6,
                      cy,
                      text="pinky\n(ulnar)", fill=pal.dim,
                      font=("Segoe UI", 8),
                      anchor="e" if thumb_on_right else "w",
                      justify="right" if thumb_on_right else "left")

        # ALIGNED / OFF-CENTRE readout on its own line above the
        # sensor legend. The number is always shown — that's what
        # gets saved.
        arc_mm = _arc_mm(rot, self.limb.circumference_mm)
        sign = "+" if rot > 0 else ""
        if aligned:
            readout = f"{rot}° — ALIGNED"
        else:
            readout = f"{sign}{rot}° — OFF CENTRE ({abs(arc_mm)} mm)"
        readout_y = p2["draw_y1"] - 32
        c.create_text(cx, readout_y, text=readout,
                      fill=pal.ok if aligned else pal.warn,
                      font=("Segoe UI Semibold", 11), anchor="center")

        # Sensor legend — single row at the bottom of the drawing
        # band, drawn ANATOMICALLY left-to-right (ulnar → radial) so
        # ch1 always sits under the pinky side of the diagram.
        legend_y = p2["draw_y1"] - 10
        legend_spacing = 90
        max_w = p2["artwork_x1"] - p2["artwork_x0"] - 20
        if legend_spacing * 3 > max_w:
            legend_spacing = max(60, int(max_w / 3))
        for i in range(3):
            colour = pal.electrode[i]
            lx = cx + (i - 1) * legend_spacing
            c.create_oval(lx - 5, legend_y - 5, lx + 5, legend_y + 5,
                          fill=colour, outline=pal.bg, width=1)
            c.create_text(lx + 9, legend_y,
                          text=ELECTRODES[i][0],
                          fill=colour, font=("Segoe UI Semibold", 9),
                          anchor="w")

    # -- hand outline (side view, intact arms only) ---------------------

    def _draw_hand(self, g: Dict[str, Any],
                   cx: float, wrist_y: float, wrist_half: float) -> None:
        """Anatomical schematic hand joined to the wrist.

        Palm is a rounded rectangle overlapping the top of the forearm
        so no seam is visible at the wrist. Four fingers overlap the
        top of the palm. Thumb originates AT the palm edge (its base
        overlaps the palm outline) and extends distally at ~45° on the
        anatomically-outboard side.

        Thumb side per contract: LEFT arm → screen right, RIGHT arm →
        screen left. Angle is +45 deg in canvas polar (up-and-right)
        for LEFT, +135 deg (up-and-left) for RIGHT.
        """
        c = self.canvas
        pal = self.p
        s = arm_screen_sign(self.limb.arm)     # +1 left → thumb on right
        max_h = HAND_RESERVE_H - 8
        palm_w = wrist_half * 2.0
        palm_h = min(palm_w * 1.05, max_h * 0.55)
        # Palm overlaps the top of the forearm by ~4 px so their
        # outlines join with no seam. Palm top / bottom in screen y.
        overlap = 4.0
        palm_bot_y = wrist_y + overlap
        palm_top_y = palm_bot_y - palm_h
        _rr = _rounded_rect_pts_fn
        c.create_polygon(
            *_rr(cx - palm_w / 2, palm_top_y,
                 cx + palm_w / 2, palm_bot_y,
                 r=min(palm_w * 0.22, palm_h * 0.28)),
            fill=pal.skin, outline=pal.skin_edge, width=2, smooth=True,
            tags=("hand-geom",))
        # Fingers — four rounded rectangles, overlapping the top of
        # the palm so no seam is visible. Graduated lengths.
        finger_lens_frac = (0.75, 0.95, 0.80, 0.55)  # index, middle, ring, pinky
        max_finger_len = max_h - palm_h - 2
        finger_w = palm_w / 4.6
        finger_overlap = 4.0
        for k, frac in enumerate(finger_lens_frac):
            length = min(palm_h * frac, max_finger_len)
            fx = cx - palm_w / 2 + (k + 0.5) * (palm_w / 4)
            c.create_polygon(
                *_rr(fx - finger_w / 2,
                     palm_top_y - length,
                     fx + finger_w / 2,
                     palm_top_y + finger_overlap,
                     r=finger_w * 0.42),
                fill=pal.skin, outline=pal.skin_edge, width=1, smooth=True,
                tags=("hand-geom",))
        # Thumb — rounded rectangle rotated ~45°, base INSIDE the palm
        # so the outlines overlap. Length ~60% of the longest finger,
        # visibly thicker.
        longest_finger = palm_h * finger_lens_frac[1]
        thumb_len = min(longest_finger * 0.7, max_finger_len * 0.7)
        thumb_w   = finger_w * 1.5
        # Anchor the thumb base INSIDE the palm, slightly below the
        # top-outboard corner. The base overlaps the palm outline so
        # there is no visible gap.
        base_x = cx + s * palm_w * 0.30
        base_y = palm_top_y + palm_h * 0.35
        # Angle in canvas polar (0 = east, +90 = north).
        # LEFT arm: thumb points UP-RIGHT (~45 deg).
        # RIGHT arm: thumb points UP-LEFT (~135 deg).
        thumb_angle_deg = 45.0 if s > 0 else 135.0
        thumb_pts = _rotated_rounded_rect_pts(
            base_x, base_y, thumb_len, thumb_w, thumb_angle_deg,
            corner_r=thumb_w * 0.42)
        c.create_polygon(
            thumb_pts, fill=pal.skin, outline=pal.skin_edge, width=2,
            smooth=True, tags=("hand-geom",))

    # -- the arm with no forearm ----------------------------------------

    def _draw_no_forearm(self, g: Dict[str, Any]) -> None:
        """Upper-arm stump only. Distal (elbow amputation) is at the TOP
        of the panel, shoulder at the bottom. Panel 2 carries the
        explanatory message plus a small reference upper-arm
        cross-section so the anatomy is still documented.
        """
        c, pal = self.canvas, self.p
        p1, p2 = g["p1"], g["p2"]
        cx = p1["arm_cx"]
        y_top = p1["draw_y0"] + 40
        y_bot = p1["draw_y1"] - 40
        stump_top = y_top + (y_bot - y_top) * 0.35
        max_half = (p1["artwork_x1"] - p1["artwork_x0"]) * 0.35
        half = min(max_half, 48.0)

        # Single continuous polygon: shoulder (widest) at bottom,
        # tapering slightly to elbow-end, closing in a smooth
        # hemisphere at the top. No separate ellipse — no lump.
        pts: List[float] = [
            cx - half * 1.05, y_bot,
            cx - half,        (y_bot + stump_top) / 2,
            cx - half * 0.9,  stump_top,
        ]
        for i in range(1, 12):
            theta = 180.0 - 180.0 * i / 12
            rad = math.radians(theta)
            pts.extend([cx + (half * 0.9) * math.cos(rad),
                        stump_top - (half * 0.9) * math.sin(rad)])
        pts.extend([
            cx + half * 0.9, stump_top,
            cx + half,       (y_bot + stump_top) / 2,
            cx + half * 1.05, y_bot,
        ])
        c.create_polygon(pts, fill=pal.skin, outline=pal.skin_edge,
                         width=2, smooth=True)

        # Shoulder crease at bottom; elbow-end label at top.
        c.create_line(cx - half * 1.15, y_bot, cx + half * 1.15, y_bot,
                      fill=pal.dim, width=2, dash=(3, 3))
        c.create_text(p1["left_g_x1"] - 8, y_bot,
                      text="shoulder",
                      fill=pal.dim, font=("Segoe UI", 9), anchor="e")
        c.create_text(p1["left_g_x1"] - 8, stump_top - half * 0.9 - 14,
                      text="limb ends\nat the elbow",
                      fill=pal.bad, font=("Segoe UI Semibold", 9),
                      anchor="e", justify="right")

        # Panel 2 — message stack + reference upper-arm cross-section.
        cx2 = p2["artwork_cx"]
        art_w = (p2["artwork_x1"] - p2["artwork_x0"]) - 12
        c.create_text(cx2, p2["draw_y0"] + 22,
                      text="No forearm segment.",
                      fill=pal.bad, font=("Segoe UI Semibold", 12))
        c.create_text(cx2, p2["draw_y0"] + 58,
                      text="The band cannot be placed on this side.",
                      fill=pal.dim, font=("Segoe UI", 10),
                      width=art_w, justify="center")
        # Reference upper-arm cross-section — smaller than the forearm
        # cross-section, humerus + biceps/triceps compartments,
        # labelled "reference only".
        ref_cy = p2["draw_y0"] + 156
        ref_r  = 42
        c.create_oval(cx2 - ref_r, ref_cy - ref_r,
                      cx2 + ref_r, ref_cy + ref_r,
                      fill=pal.skin, outline=pal.skin_edge, width=2)
        # Humerus — a single central bone, offset slightly posterior.
        c.create_oval(cx2 - ref_r * 0.18, ref_cy - ref_r * 0.30,
                      cx2 + ref_r * 0.18, ref_cy + ref_r * 0.10,
                      fill=pal.bone, outline="")
        # Biceps / triceps compartment labels — placed OUTSIDE the
        # arm circle so their bboxes don't collide with the arm oval.
        # Humerus label sits in the LEFT gutter with a leader line, so
        # a helper can still tell which oval is which.
        c.create_text(cx2, ref_cy + ref_r + 14,
                      text="biceps (anterior)",
                      fill=pal.dim, font=("Segoe UI", 8))
        c.create_text(cx2, ref_cy - ref_r - 14,
                      text="triceps (posterior)",
                      fill=pal.dim, font=("Segoe UI", 8))
        # Humerus label sits in the left gutter at the bone's y level;
        # no leader line — the visual pairing is unambiguous and a
        # line here would collide with the label's own bbox.
        c.create_text(p2["left_g_x1"] - 6, ref_cy - ref_r * 0.15,
                      text="humerus →", fill=pal.dim,
                      font=("Segoe UI", 8), anchor="e")
        c.create_text(cx2, ref_cy + ref_r + 32,
                      text="reference only — not a placement target",
                      fill=pal.warn, font=("Segoe UI Semibold", 8))
        c.create_text(cx2, p2["draw_y1"] - 20,
                      text="(Upper-arm placement records biceps / "
                           "triceps — a coarse extra switch, never "
                           "finger movement.)",
                      fill=pal.dim, font=("Segoe UI", 8),
                      width=art_w, justify="center")

        # Hints — dragging disabled everywhere in this state.
        c.create_text(p1["title_cx"], p1["hint_y"],
                      text="no placement — nothing to drag",
                      fill=pal.dim, font=("Segoe UI", 9))
        c.create_text(p2["title_cx"], p2["hint_y"],
                      text="",
                      fill=pal.dim, font=("Segoe UI", 9))

    # -- unknown anatomy -------------------------------------------------

    def _draw_unknown_anatomy(self, g: Dict[str, Any]) -> None:
        """Explicit error state — never guess what's under a band.

        Rendered when a profile's Limb has level == UNKNOWN. Drawing a
        hand or falling back to intact would tell a helper to place a
        band on anatomy that does not exist.
        """
        c, pal = self.canvas, self.p
        for panel in (g["p1"], g["p2"]):
            cx = panel["artwork_cx"]
            cy = (panel["draw_y0"] + panel["draw_y1"]) / 2
            art_w = (panel["artwork_x1"] - panel["artwork_x0"]) - 12
            c.create_text(cx, cy - 48,
                          text="No anatomy defined",
                          fill=pal.bad,
                          font=("Segoe UI Semibold", 14))
            c.create_text(cx, cy - 8,
                          text=f"for {self.profile_name or 'this profile'} "
                               f"/ {self.limb.arm} arm.",
                          fill=pal.dim, font=("Segoe UI", 10),
                          width=art_w, justify="center")
            c.create_text(cx, cy + 44,
                          text="Enter amputation level and residual length "
                               "in this profile's anatomy block before "
                               "recording.",
                          fill=pal.dim, font=("Segoe UI", 9),
                          width=art_w, justify="center")
            c.create_text(panel["title_cx"], panel["hint_y"],
                          text="no placement — anatomy unknown",
                          fill=pal.dim, font=("Segoe UI", 9))

    # -- post-render assertions -----------------------------------------

    def _assert_layout(self, g: Dict[str, Any]) -> Dict[str, int]:
        """Bounding-box checks. Returns a dict of collision counts.

        Runs after every redraw. Cheap: bboxes only.
          - text_text:   text-vs-text bbox intersections
          - text_path:   text-vs-non-text bbox intersections (excluding
                         same-tag pairs and tiny same-position dots)
          - out_of_view: elements whose bbox leaves the canvas
        Logs to stderr on non-zero. Returned dict is consumed by the
        acceptance test.
        """
        c = self.canvas
        w = int(g["w"]); h = int(g["h"])
        texts: List[Tuple[int, str, Tuple[float, float, float, float]]] = []
        paths: List[Tuple[int, str, Tuple[float, float, float, float]]] = []
        oob: List[str] = []
        for iid in c.find_all():
            typ = c.type(iid)
            try:
                b = c.bbox(iid)
            except Exception:
                continue
            if b is None:
                continue
            x0, y0, x1, y1 = b
            if x0 < -2 or y0 < -2 or x1 > w + 2 or y1 > h + 2:
                label = c.itemcget(iid, "text") if typ == "text" else typ
                oob.append(f"OOB {typ} {label!r} {b}")
            if typ == "text":
                texts.append((iid, c.itemcget(iid, "text"), b))
            else:
                paths.append((iid, typ, b))

        def intersects(a, b):
            return not (a[2] < b[0] or b[2] < a[0]
                        or a[3] < b[1] or b[3] < a[1])

        text_text: List[str] = []
        for i in range(len(texts)):
            for j in range(i + 1, len(texts)):
                _, t1, b1 = texts[i]
                _, t2, b2 = texts[j]
                if not t1.strip() or not t2.strip():
                    continue
                if intersects(b1, b2):
                    text_text.append(f"TEXT×TEXT {t1!r} × {t2!r}")

        text_path: List[str] = []
        for iid_t, txt, tb in texts:
            if not txt.strip():
                continue
            # Text bbox in tkinter includes a couple of pixels of
            # padding — shrink by 1px on each side so a tiny overlap
            # with a line grazing the label doesn't register.
            shrunk = (tb[0] + 1, tb[1] + 1, tb[2] - 1, tb[3] - 1)
            for iid_p, ptyp, pb in paths:
                # Ignore path elements that are effectively points
                # (contacts, LED, tiny legend dots) — they can't
                # obscure text they're spaced away from.
                if (pb[2] - pb[0] <= 4 and pb[3] - pb[1] <= 4):
                    continue
                if intersects(shrunk, pb):
                    text_path.append(
                        f"TEXT×{ptyp} {txt!r} × {pb}")

        counts = {"text_text": len(text_text),
                  "text_path": len(text_path),
                  "out_of_view": len(oob)}
        if any(counts.values()):
            import sys
            print(f"[LimbDiagram] {counts}", file=sys.stderr)
            for p in (oob + text_text + text_path)[:8]:
                print("  " + p, file=sys.stderr)
        return counts

    # -- non-intact regression assertion --------------------------------

    def _regression_no_hand_geometry(self) -> bool:
        """True if this render is non-intact and produced no hand marks.

        Called by the acceptance test — see WORKLOG. The test tags
        every element with 'hand' when it's part of a hand or finger,
        and this method asserts that count is zero for non-intact
        profiles.
        """
        if self.limb.level == INTACT:
            return True
        return not self.canvas.find_withtag("hand-geom")

    # ------------------------------------------------------------ pointing

    def _on_press(self, event) -> None:
        if not self.limb.has_forearm:
            return  # transhumeral panels are non-interactive
        g = self._geometry()
        # Left panel = slide (distance), right panel = rotate.
        self._drag = "slide" if event.x < g["split"] else "rotate"
        self._on_drag(event)

    def _on_drag(self, event) -> None:
        if self._drag is None:
            return
        g = self._geometry()
        # Shift-drag = fine (1 unit); otherwise snap to 5.
        fine = bool(getattr(event, "state", 0) & 0x0001)
        step = 1 if fine else 5
        if self._drag == "slide":
            lo, hi = self.limb.band_range_mm
            mm = self._mm_for_y(g, event.y)
            mm = int(round(mm / step) * step)
            self.placement.distance_mm = int(min(max(mm, lo), hi))
        else:
            p2 = g["p2"]
            dx = event.x - p2["sec_cx"]
            dy = event.y - p2["sec_cy"]
            if abs(dx) < 1 and abs(dy) < 1:
                return
            # Where the pointer is in polar coords — this is where the
            # user wants the black centring mark to appear on screen.
            # Convert back to anatomical rotation by dividing out the
            # arm's screen mirror sign.
            angle = math.degrees(math.atan2(-dy, dx)) % 360.0
            screen_offset = ((angle - PALM_CENTRE_DEG + 180.0) % 360.0) - 180.0
            anatomical = screen_offset * arm_screen_sign(self.limb.arm)
            snapped = int(round(anatomical / step) * step)
            self.placement.rotation_deg = max(-ROTATION_CLAMP_DEG,
                                              min(ROTATION_CLAMP_DEG,
                                                  snapped))
        self.redraw()
        if self.on_change:
            self.on_change(self.placement)


def _polar(cx: float, cy: float, r: float, deg: float) -> Tuple[float, float]:
    rad = math.radians(deg)
    return cx + r * math.cos(rad), cy - r * math.sin(rad)


def _rounded_rect_pts_fn(x0: float, y0: float, x1: float, y1: float,
                         r: float) -> List[float]:
    """Flat point list for a rounded rectangle polygon.

    Draw via `canvas.create_polygon(*_rounded_rect_pts_fn(...),
    smooth=True)` — tkinter's smoothing turns the 12-point path into
    Bezier-curved corners.
    """
    r = max(0.0, min(r, (x1 - x0) / 2, (y1 - y0) / 2))
    return [
        x0 + r, y0,   x1 - r, y0,
        x1, y0,       x1, y0 + r,
        x1, y1 - r,   x1, y1,
        x1 - r, y1,   x0 + r, y1,
        x0, y1,       x0, y1 - r,
        x0, y0 + r,   x0, y0,
    ]


def _rotated_rounded_rect_pts(cx: float, cy: float,
                              length: float, width: float,
                              angle_deg: float,
                              corner_r: float = 0.0) -> List[float]:
    """Points for a rounded rectangle rotated about one end.

    (cx, cy) is the CENTRE of the near-end short edge; the rectangle
    extends `length` in the direction of `angle_deg` and is `width`
    wide perpendicular to it. Angle uses canvas polar (0 = east,
    positive counter-clockwise on screen).
    """
    rad = math.radians(angle_deg)
    ax, ay = math.cos(rad), -math.sin(rad)   # along-axis unit vector
    px, py = -ay, ax                          # perpendicular unit vector
    half = width / 2
    # Corner points of the un-rounded rect.
    near_l = (cx + px * half,                cy + py * half)
    near_r = (cx - px * half,                cy - py * half)
    far_r  = (cx + ax * length - px * half,  cy + ay * length - py * half)
    far_l  = (cx + ax * length + px * half,  cy + ay * length + py * half)
    # 12-point rounded-rect walk: for each corner emit three points
    # (before-corner, corner, after-corner). corner_r is applied along
    # the along-axis and perpendicular directions.
    r = min(corner_r, length / 2, width / 2)
    def offset(pt, dx, dy):
        return (pt[0] + ax * dx + px * dy, pt[1] + ay * dx + py * dy)
    pts = [
        offset(near_l,  r,  0), offset(near_l,  0,  0), offset(near_l,  0, -r),
        offset(near_r,  0,  r), offset(near_r,  0,  0), offset(near_r,  r,  0),
        offset(far_r,  -r,  0), offset(far_r,   0,  0), offset(far_r,   0,  r),
        offset(far_l,   0, -r), offset(far_l,   0,  0), offset(far_l,  -r,  0),
    ]
    out: List[float] = []
    for p in pts:
        out.extend(p)
    return out


def _arc_ring_pts(cx: float, cy: float,
                  r_inner: float, r_outer: float,
                  start_deg: float, extent_deg: float,
                  step_deg: float = 3.0) -> List[float]:
    """Flat point list for a filled arc-shaped ring polygon.

    Walks the outer arc from start to start+extent, then the inner arc
    back the other way, producing a closed polygon suitable for
    canvas.create_polygon(*pts, fill=...).
    """
    n = max(2, int(abs(extent_deg) / step_deg))
    outer: List[Tuple[float, float]] = []
    inner: List[Tuple[float, float]] = []
    for i in range(n + 1):
        deg = start_deg + extent_deg * i / n
        outer.append(_polar(cx, cy, r_outer, deg))
        inner.append(_polar(cx, cy, r_inner, deg))
    inner.reverse()
    out: List[float] = []
    for x, y in outer + inner:
        out.extend((x, y))
    return out


def _draw_sensor_pad(canvas, cx: float, cy: float,
                     r_inner: float, r_outer: float,
                     centre_deg: float, halfwidth_deg: float,
                     fill: str, outline: str = "",
                     tag_group: str = "") -> None:
    """Rounded-rectangle sensor pad, flush against the inner band surface.

    Drawn as an arc-shaped ring polygon; smooth=True gives it curved
    ends so it reads as a pad rather than a wedge. Bigger than an
    electrode dot — visible against the dark housing.
    """
    pts = _arc_ring_pts(cx, cy, r_inner, r_outer,
                        centre_deg - halfwidth_deg,
                        2 * halfwidth_deg, step_deg=1.0)
    kw = dict(fill=fill, outline=outline, width=1, smooth=True)
    if tag_group:
        kw["tags"] = (tag_group,)
    canvas.create_polygon(*pts, **kw)


def _arc_mm(deg: float, circumference_mm: int) -> int:
    """Signed arc length in mm for a rotation offset in degrees."""
    if circumference_mm <= 0:
        return 0
    return int(round(deg / 360.0 * circumference_mm))


def _off_centre_side(deg: int, arm: str = "") -> str:
    """Which physical side the mark has drifted toward.

    `rotation_deg` is stored in anatomical space (positive = radial /
    thumb, negative = ulnar / pinky), so this is arm-independent.
    """
    if deg == 0:
        return "of centre"
    return "toward thumb" if deg > 0 else "toward pinky"


# ------------------------------------------------------------------ text


def placement_steps(limb: Limb, placement: Placement) -> List[str]:
    """How to put the band exactly where the diagram says it is."""
    if not limb.has_forearm:
        return [
            "There is no forearm on this side, so there is no forearm "
            "placement to reproduce.",
            "If you are recording from the upper arm, put the band around "
            "the thickest part of the biceps and write down which way the "
            "cable faces. Expect one coarse signal, not finger movement.",
        ]
    lo, hi = limb.band_range_mm
    arc_mm = _arc_mm(placement.rotation_deg, limb.circumference_mm)
    if placement.rotation_deg == 0:
        rot_step = ("Line the black centring mark on the outside of the "
                    "band up with the middle of the palm side of the "
                    "forearm.")
    else:
        side = _off_centre_side(placement.rotation_deg, limb.arm)
        rot_step = (f"The saved placement has the black centring mark "
                    f"about {abs(arc_mm)} mm {side} from palm centre. "
                    f"Line it up the same way.")
    steps = [
        f"Find the elbow crease. Every measurement starts there.",
        f"Slide the band down to {placement.distance_mm} mm from the crease "
        f"— the usable window is {lo}–{hi} mm.",
        rot_step,
        "The thicker (sensor) end of the band goes on the palm side; "
        "the velcro strap closes across the back of the forearm.",
        "Snug, not tight. You should be able to slip a finger under the "
        "strap without the electrodes lifting.",
        "Check the live meters: the three bars should move independently "
        "when he attempts different movements. If they all move together, "
        "reseat the band and try again.",
    ]
    if not limb.fits(placement.distance_mm):
        steps.insert(0, "⚠ The saved position is outside the window this "
                        "limb allows. Move the band before recording.")
    return steps


def _rotation_words(deg: int, arm: str = "right",
                    circumference_mm: int = 240) -> str:
    """How far the black centring mark is off palm-centre, in words."""
    if abs(deg) <= 2:
        return "centred on the palm side, on the black mark"
    mm = abs(_arc_mm(deg, circumference_mm))
    return f"{mm} mm {_off_centre_side(deg, arm)}"


if __name__ == "__main__":
    import sys
    import tkinter as tk

    for arm, limb in KYLE_LIMBS.items():
        print(f"--- {arm}: {LEVEL_NAMES[limb.level]}")
        print("   ", limb.headline())
        if limb.caution():
            print("   !", limb.caution())
        place = Placement(arm=arm, distance_mm=limb.default_distance_mm(),
                          rotation_deg=0,
                          on_upper_arm=not limb.has_forearm)
        print("   ", place.describe())
        for step in placement_steps(limb, place):
            print("     ·", step)
        moved = Placement(arm=arm, distance_mm=place.distance_mm + 25,
                          rotation_deg=25,
                          on_upper_arm=place.on_upper_arm)
        print("    drift:", moved.drift_from(place) or "(n/a)")

    # The window is opt-in: a bare `python anatomy.py` has to return so
    # it can sit in an automated sweep alongside every other module.
    if "--show" not in sys.argv:
        print("\nOK  (run with --show to see the diagrams)")
        raise SystemExit(0)

    root = tk.Tk()
    root.title("anatomy.py — limb diagrams")
    root.configure(bg=Palette().bg)
    for arm, limb in KYLE_LIMBS.items():
        tk.Label(root, text=f"{arm}: {limb.headline()}", bg=Palette().bg,
                 fg=Palette().text, font=("Segoe UI", 10), wraplength=680,
                 justify="left").pack(anchor="w", padx=12, pady=(10, 2))
        canvas = tk.Canvas(root, width=700, height=210, highlightthickness=0)
        canvas.pack(padx=12, pady=(0, 8))
        place = Placement(arm=arm, distance_mm=limb.default_distance_mm(),
                          on_upper_arm=not limb.has_forearm)
        diagram = LimbDiagram(canvas, limb, place)
        root.after(60, diagram.redraw)
    root.mainloop()
