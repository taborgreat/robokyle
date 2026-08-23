"""Unit tests for placement_contract — the coordinate contract.

Run with: `python armband/test_placement_contract.py`

These are the assertions the CLAUDE.md commitment rests on. If any
of them regress, downstream tooling (renderer, CSV writer, analysis)
will silently disagree on what a stored rotation means. Do NOT weaken
these tests; fix the underlying code.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import placement_contract as pc


def assert_eq(actual, expected, message=""):
    if actual != expected:
        raise AssertionError(f"{message}: expected {expected!r}, got {actual!r}")


def assert_close(a, b, tol=1e-6, message=""):
    if abs(a - b) > tol:
        raise AssertionError(f"{message}: {a} vs {b}")


def test_round_trip_preserves_value():
    """Save → load → save must never drift."""
    for arm in ("left", "right"):
        for anat in range(-90, 91, 5):
            screen = pc.anatomical_to_screen(anat, arm)
            back = pc.screen_to_anatomical(screen, arm)
            assert_eq(int(round(back)), anat,
                      f"round-trip {arm} anat={anat}")


def test_mirroring_is_symmetric():
    """A given anatomical angle should mirror between arms."""
    for anat in (-90, -45, -18, 0, 18, 45, 90):
        left_screen = pc.anatomical_to_screen(anat, "left")
        right_screen = pc.anatomical_to_screen(anat, "right")
        # The two screen angles should be reflections of each other
        # across the palm-centre axis (270 deg).
        left_offset = ((left_screen - pc.PALM_CENTRE_DEG + 180) % 360) - 180
        right_offset = ((right_screen - pc.PALM_CENTRE_DEG + 180) % 360) - 180
        assert_close(left_offset, -right_offset, 1e-4,
                     f"mirror anat={anat}")


def test_ch1_on_pinky_side_both_arms():
    """ch1 (ulnar) must render on the pinky side of the diagram.

    LEFT arm palm-down viewed proximal→distal: pinky is on screen LEFT.
    RIGHT arm same view: pinky is on screen RIGHT.

    In screen polar coordinates: screen-LEFT of palm-centre (270 deg)
    means cos(angle) < 0; screen-RIGHT means cos(angle) > 0.
    """
    for arm, pinky_screen_x_sign in (("left", -1), ("right", +1)):
        angles = pc.anatomical_electrode_angles(0, arm)
        ch1_x = math.cos(math.radians(angles[0]))
        actual = -1 if ch1_x < 0 else +1
        assert_eq(actual, pinky_screen_x_sign,
                  f"ch1 pinky-side {arm}")


def test_ch3_on_thumb_side_both_arms():
    """ch3 (radial) must render on the thumb side of the diagram."""
    for arm, thumb_screen_x_sign in (("left", +1), ("right", -1)):
        angles = pc.anatomical_electrode_angles(0, arm)
        ch3_x = math.cos(math.radians(angles[2]))
        actual = -1 if ch3_x < 0 else +1
        assert_eq(actual, thumb_screen_x_sign,
                  f"ch3 thumb-side {arm}")


def test_rotation_moves_sensors_toward_thumb():
    """+45 deg anatomical must move the sensor cluster toward the
    thumb on both arms — the whole point of the anatomical convention.
    """
    for arm in ("left", "right"):
        cluster_x_zero = sum(math.cos(math.radians(a))
                             for a in pc.anatomical_electrode_angles(0, arm))
        cluster_x_thumb = sum(math.cos(math.radians(a))
                              for a in pc.anatomical_electrode_angles(45, arm))
        if arm == "left":
            # Thumb on screen RIGHT → cluster should shift +x.
            assert cluster_x_thumb > cluster_x_zero + 0.1, (
                f"LEFT arm +45 didn't move sensors right: "
                f"x0={cluster_x_zero:.3f} x45={cluster_x_thumb:.3f}")
        else:
            # Thumb on screen LEFT → cluster should shift -x.
            assert cluster_x_thumb < cluster_x_zero - 0.1, (
                f"RIGHT arm +45 didn't move sensors left: "
                f"x0={cluster_x_zero:.3f} x45={cluster_x_thumb:.3f}")


def test_band_range_matches_contract_formula():
    """The usable range is derived from BAND_WIDTH_MM / CLEARANCE, not
    a hardcoded fraction."""
    for length in (100, 235, 260, 280):
        lo, hi = pc.band_range_mm(length)
        if length > pc.BAND_WIDTH_MM + 2 * pc.BAND_CLEARANCE_MM:
            assert_eq(hi, length - pc.BAND_WIDTH_MM // 2 - pc.BAND_CLEARANCE_MM,
                      f"hi for length {length}")
            assert_eq(lo, pc.BAND_WIDTH_MM // 2 + pc.BAND_CLEARANCE_MM,
                      f"lo for length {length}")


def test_convention_version_is_positive_int():
    assert isinstance(pc.PLACEMENT_CONVENTION_VERSION, int)
    assert pc.PLACEMENT_CONVENTION_VERSION >= 1


TESTS = [
    test_round_trip_preserves_value,
    test_mirroring_is_symmetric,
    test_ch1_on_pinky_side_both_arms,
    test_ch3_on_thumb_side_both_arms,
    test_rotation_moves_sensors_toward_thumb,
    test_band_range_matches_contract_formula,
    test_convention_version_is_positive_int,
]


if __name__ == "__main__":
    passed = 0
    failed = 0
    for t in TESTS:
        try:
            t()
            print(f"  PASS  {t.__name__}")
            passed += 1
        except AssertionError as e:
            print(f"  FAIL  {t.__name__}: {e}")
            failed += 1
    print(f"\n{passed} passed, {failed} failed  "
          f"(convention v{pc.PLACEMENT_CONVENTION_VERSION})")
    sys.exit(0 if failed == 0 else 1)
