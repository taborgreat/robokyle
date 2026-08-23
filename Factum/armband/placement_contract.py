"""The placement coordinate contract — one source of truth.

Every value in this module is authoritative. The renderer imports it,
the data layer imports it, the CSV writer imports it. Nothing in the
project may hardcode a distance datum, a rotation convention, a channel
number, a band dimension, or a view direction — those live here and
only here. If a value needs to change, it changes here and
`PLACEMENT_CONVENTION_VERSION` increments.

Reading this in five years with no context
------------------------------------------

Every recording in this project is stamped with two numbers describing
where the Mudra Band sat on the arm: `placement_distance_mm` and
`placement_rotation_deg`. These are what you replay, session over
session, to compare two recordings honestly. If they mean two different
things depending on who wrote them, the whole archive is worthless. So
this module defines exactly what they mean.

DISTANCE — `placement_distance_mm`
    Datum:      the elbow crease is 0 mm.
    Reference:  the CENTRE of the band, not either edge.
    Direction:  positive is distal — toward the hand.
    Type:       integer millimetres, ≥ 0.

ROTATION — `placement_rotation_deg`
    Datum:      0 deg means the band's centre reference line (the black
                mark on the strap) is aligned with the forearm midline
                on the VOLAR (palm) surface. In other words: the strap
                sits on top of the dorsal side, the housing sits on the
                palm side, and the mark is exactly on the arm's
                midline.
    Direction:  positive rotates the SENSOR ARRAY toward the RADIAL
                (thumb) side of the forearm. Negative rotates it toward
                the ULNAR (pinky) side.
    Scope:      this is an ANATOMICAL convention. It does not depend
                on which arm. A saved +18 deg means "18 deg toward the
                thumb" on the left arm and "18 deg toward the thumb" on
                the right arm — the SCREEN reflects that differently
                because you are viewing mirrored anatomy.
    Range:      integer degrees. Physically only ±90 or so is sensible;
                storage is not clamped further than ±180 so unusual
                placements are still expressible without wrapping.

CHANNELS
    ch1 = ULNAR  (pinky-side sensor)
    ch2 = MEDIAN (centre sensor, sits under the black centring mark)
    ch3 = RADIAL (thumb-side sensor)
    The mapping is anatomical. It is identical on both arms. Only the
    left-to-right order on the DRAWING flips (because thumb-side flips
    between arms in the cross-section view), never the assignment.

VIEW DIRECTION (for drawings only — no effect on stored values)
    LONGITUDINAL:  viewed from ABOVE with the palm DOWN. Elbow at the
                   bottom of the drawing, hand at the top. Distal is
                   up.
    CROSS-SECTION: viewed from the ELBOW looking toward the HAND
                   (proximal → distal). Palm side is the bottom of the
                   drawing, dorsal side is the top.
    Both views therefore agree on which SCREEN side is the thumb:
        LEFT  arm → thumb on the RIGHT of the drawing
        RIGHT arm → thumb on the LEFT of the drawing

BAND GEOMETRY
    BAND_WIDTH_MM       physical width of the band along the arm
    BAND_CLEARANCE_MM   safety margin from the distal end
    SENSOR_SPACING_MM   arc distance between adjacent sensor pads
                        (measured across the palm-side surface)
    Usable range for the band CENTRE:
        [BAND_WIDTH_MM/2 + BAND_CLEARANCE_MM,
         forearm_length_mm - BAND_WIDTH_MM/2 - BAND_CLEARANCE_MM]

CSV header fields (`probe_store.header_lines`)
    Every probe CSV includes:
        arm
        placement_distance_mm
        placement_rotation_deg
        placement_convention_version   (this file's version)
        anatomy_source                 (MEASURED | ESTIMATED)
    Never omit these. Absent means "not recorded" which is a bug, not
    a state.

Never reinterpret
-----------------

The renderer converts anatomical rotation to a screen angle at draw
time via `anatomical_to_screen(deg, arm)`. The inverse conversion
(pointer angle → stored value) is `screen_to_anatomical(deg, arm)`.
No other place in the codebase may perform this conversion — always
call through these helpers. If you find yourself computing
`sign * rotation_deg` inline, stop and call the helper.
"""

from __future__ import annotations

from typing import Tuple

# --------------------------------------------------------------- version

# Bump when any convention below changes in a way that a stored value
# would be interpreted differently. Existing recordings keep their old
# convention_version so we can migrate consciously.
PLACEMENT_CONVENTION_VERSION = 1

# --------------------------------------------------------------- channels

# Anatomical channel assignment. Never overridden by anything downstream.
CH_ULNAR  = "ch1"
CH_MEDIAN = "ch2"
CH_RADIAL = "ch3"

# (channel, nerve/side, screen-side rule) — for legends and CSV headers.
CHANNELS: Tuple[Tuple[str, str, str], ...] = (
    (CH_ULNAR,  "ulnar",  "pinky side"),
    (CH_MEDIAN, "median", "centreline"),
    (CH_RADIAL, "radial", "thumb side"),
)
CHANNEL_LEGEND = f"{CH_ULNAR}=ulnar, {CH_MEDIAN}=median, {CH_RADIAL}=radial"

# --------------------------------------------------------------- geometry

# Real-band geometry. BAND_WIDTH_MM is measured against the device; if
# you re-measure and it differs from this value, update it here and
# bump PLACEMENT_CONVENTION_VERSION only if the change is large enough
# to reinterpret existing recordings (>2 mm).
BAND_WIDTH_MM      = 40   # length of the housing along the arm
BAND_CLEARANCE_MM  = 5    # safety margin from either end of the arm
SENSOR_SPACING_MM  = 6    # arc distance between adjacent sensor pads

# Half-arc widths for the two band sections, in degrees on the arm
# cross-section. Housing wraps ~200 deg across the palm side; strap
# closes the remaining ~160 deg across the dorsal side.
BAND_RIGID_HALF_ARC_DEG = 100.0
BAND_STRAP_HALF_ARC_DEG =  80.0

# Alignment tolerance and stored-value clamps.
ALIGNED_TOL_DEG    = 2      # within this the mark reads as on the midline
ROTATION_CLAMP_DEG = 90     # anything past a quarter turn is a nonsense fit

# ---------------------------------------------------------- view directions

# Canvas polar convention: 0 deg = east, positive counter-clockwise on
# screen (y goes down on the canvas, so `y = cy - r * sin(deg)`).
PALM_CENTRE_DEG   = 270.0   # bottom of the cross-section (palm faces down)
DORSAL_CENTRE_DEG =  90.0   # top of the cross-section (velcro strap)

# Sensor offsets around the arm at rotation 0, stated in ANATOMICAL
# space: negative = toward the ulnar (pinky) side, positive = toward
# the radial (thumb) side. The renderer maps these to screen angles
# through `arm_screen_sign(arm)` so ch1 always renders on the pinky
# side of the diagram regardless of arm side.
_HALF_STEP_DEG = 9.0        # ~6 mm arc on a 240 mm forearm circumference
ELECTRODE_ANATOMICAL_OFFSETS_DEG: Tuple[float, float, float] = (
    -_HALF_STEP_DEG, 0.0, _HALF_STEP_DEG,
)

# ---------------------------------------------------------- anatomy source

# Kept as string constants (not Enum) because they land verbatim in
# CSV headers and JSON — no need for an extra layer.
SOURCE_MEASURED  = "MEASURED"
SOURCE_ESTIMATED = "ESTIMATED"
VALID_SOURCES    = (SOURCE_MEASURED, SOURCE_ESTIMATED)

# --------------------------------------------------------- axis conversion

def arm_screen_sign(arm: str) -> int:
    """Anatomical → screen sign for the cross-section (proximal → distal).

    LEFT arm palm-down viewed from the elbow toward the hand: thumb
    (radial) appears on the RIGHT of the drawing, so a positive
    anatomical offset (toward radial) is a positive screen offset →
    sign +1.
    RIGHT arm same view: thumb appears on the LEFT of the drawing →
    sign −1.
    """
    if arm not in ("left", "right"):
        raise ValueError(f"arm must be 'left' or 'right', got {arm!r}")
    return 1 if arm == "left" else -1


def anatomical_to_screen(anatomical_deg: float, arm: str) -> float:
    """Convert a stored anatomical angle to a screen polar angle.

    `anatomical_deg` is an offset from the palm-side midline in the
    anatomical frame (positive = toward the thumb). The returned value
    is degrees in the canvas polar convention, relative to
    PALM_CENTRE_DEG.
    """
    return PALM_CENTRE_DEG + arm_screen_sign(arm) * anatomical_deg


def screen_to_anatomical(screen_deg: float, arm: str) -> float:
    """Convert a pointer angle on the canvas back to an anatomical offset.

    Inverse of `anatomical_to_screen`. Result is in [-180, +180].
    """
    raw = screen_deg - PALM_CENTRE_DEG
    # Wrap into [-180, +180] so callers can clamp meaningfully.
    wrapped = ((raw + 180.0) % 360.0) - 180.0
    return wrapped * arm_screen_sign(arm)


def anatomical_electrode_angles(rotation_deg: float, arm: str
                                ) -> Tuple[float, float, float]:
    """Screen polar angles for the three sensor pads.

    ch1 (ulnar) always lands on the pinky side of the diagram; ch3
    (radial) on the thumb side. Legend order in a UI should be
    left-to-right screen order, which flips between arms — but the
    channel IDENTITY does not.
    """
    s = arm_screen_sign(arm)
    return tuple(
        (PALM_CENTRE_DEG + s * (off + rotation_deg)) % 360.0
        for off in ELECTRODE_ANATOMICAL_OFFSETS_DEG
    )  # type: ignore[return-value]


def anatomical_mark_angle(rotation_deg: float, arm: str) -> float:
    """Screen polar angle of the black centring mark on the STRAP.

    The strap is dorsal, opposite the housing. When aligned the mark
    sits on the arm midline at DORSAL_CENTRE_DEG.
    """
    return (DORSAL_CENTRE_DEG
            + arm_screen_sign(arm) * rotation_deg) % 360.0


def band_range_mm(forearm_length_mm: int) -> Tuple[int, int]:
    """Usable range for the band CENTRE on a limb of a given length."""
    if forearm_length_mm <= 0:
        return (0, 0)
    half = BAND_WIDTH_MM // 2
    lo = half + BAND_CLEARANCE_MM
    hi = forearm_length_mm - half - BAND_CLEARANCE_MM
    if hi < lo:
        return (0, 0)
    return (int(lo), int(hi))


# --------------------------------------------------------------- self-test

if __name__ == "__main__":
    # Round-trip: an anatomical offset survives conversion to screen
    # and back on BOTH arms.
    for arm in ("left", "right"):
        for anat in (-90, -45, -18, 0, 18, 45, 90):
            screen = anatomical_to_screen(anat, arm)
            back   = screen_to_anatomical(screen, arm)
            assert int(round(back)) == anat, (arm, anat, screen, back)

    # ch1 on the pinky side for BOTH arms.
    # Pinky side is the anatomical ulnar direction. In screen polar
    # coordinates, that's LEFT of the palm-centre point (angle just
    # below 270) for a LEFT arm, and RIGHT of palm-centre for a RIGHT
    # arm. So ch1's screen angle should be less-than-270 for left and
    # greater-than-270 for right (both wrapped mod 360, careful with
    # the discontinuity — since offsets are small we can compare on
    # cos of the angle instead).
    import math
    for arm, expected_x_sign in (("left", -1), ("right", +1)):
        angles = anatomical_electrode_angles(0, arm)
        ch1_x = math.cos(math.radians(angles[0]))
        # ch1_x < 0 on left arm (screen left = pinky), > 0 on right.
        actual = -1 if ch1_x < 0 else +1
        assert actual == expected_x_sign, (arm, angles, ch1_x)

    # Band range on a 260 mm arm: (25, 235) with BAND_WIDTH=40, CLEAR=5.
    assert band_range_mm(260) == (25, 235)
    assert band_range_mm(0)   == (0, 0)
    assert band_range_mm(50)  == (25, 25) or band_range_mm(50) == (0, 0)

    print("placement_contract.py self-test OK "
          f"(convention v{PLACEMENT_CONVENTION_VERSION})")
