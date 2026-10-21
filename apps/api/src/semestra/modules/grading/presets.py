"""Built-in grading scales and category templates (M03 §2)."""

from collections.abc import Sequence
from typing import Any

# (min, max, points, letter): whole-number tables as universities publish them.
_UOFT = [
    (90, 100, 4.0, "A+"),
    (85, 89, 4.0, "A"),
    (80, 84, 3.7, "A-"),
    (77, 79, 3.3, "B+"),
    (73, 76, 3.0, "B"),
    (70, 72, 2.7, "B-"),
    (67, 69, 2.3, "C+"),
    (63, 66, 2.0, "C"),
    (60, 62, 1.7, "C-"),
    (57, 59, 1.3, "D+"),
    (53, 56, 1.0, "D"),
    (50, 52, 0.7, "D-"),
    (0, 49, 0.0, "F"),
]
_US = [
    (93, 100, 4.0, "A"),
    (90, 92, 3.7, "A-"),
    (87, 89, 3.3, "B+"),
    (83, 86, 3.0, "B"),
    (80, 82, 2.7, "B-"),
    (77, 79, 2.3, "C+"),
    (73, 76, 2.0, "C"),
    (70, 72, 1.7, "C-"),
    (67, 69, 1.3, "D+"),
    (63, 66, 1.0, "D"),
    (60, 62, 0.7, "D-"),
    (0, 59, 0.0, "F"),
]
_CN = [
    (90, 100, 4.0, None),
    (85, 89, 3.7, None),
    (82, 84, 3.3, None),
    (78, 81, 3.0, None),
    (75, 77, 2.7, None),
    (72, 74, 2.3, None),
    (68, 71, 2.0, None),
    (64, 67, 1.5, None),
    (60, 63, 1.0, None),
    (0, 59, 0.0, None),
]
_US_433 = [
    (97, 100, 4.33, "A+"),
    (93, 96, 4.0, "A"),
    (90, 92, 3.67, "A-"),
    (87, 89, 3.33, "B+"),
    (83, 86, 3.0, "B"),
    (80, 82, 2.67, "B-"),
    (77, 79, 2.33, "C+"),
    (73, 76, 2.0, "C"),
    (70, 72, 1.67, "C-"),
    (67, 69, 1.33, "D+"),
    (63, 66, 1.0, "D"),
    (60, 62, 0.67, "D-"),
    (0, 59, 0.0, "F"),
]
_STANDARD = [
    (90, 100, 4.0, "A"),
    (80, 89, 3.0, "B"),
    (70, 79, 2.0, "C"),
    (60, 69, 1.0, "D"),
    (0, 59, 0.0, "F"),
]
_AU_7 = [
    (85, 100, 7.0, "HD"),
    (75, 84, 6.0, "D"),
    (65, 74, 5.0, "C"),
    (50, 64, 4.0, "P"),
    (0, 49, 0.0, "F"),
]
_KR_45 = [
    (95, 100, 4.5, "A+"),
    (90, 94, 4.0, "A0"),
    (85, 89, 3.5, "B+"),
    (80, 84, 3.0, "B0"),
    (75, 79, 2.5, "C+"),
    (70, 74, 2.0, "C0"),
    (65, 69, 1.5, "D+"),
    (60, 64, 1.0, "D0"),
    (0, 59, 0.0, "F"),
]
# "custom" starts from a single catch-all band for the user to split up.
_CUSTOM = [(0, 100, 0.0, None)]

# Preset id -> (points of a perfect grade, bands); the order is the order users see.
_PRESETS: dict[str, tuple[float, Sequence[tuple[int, int, float, str | None]]]] = {
    "uoft_4_0": (4.0, _UOFT),
    "us_4_0": (4.0, _US),
    "us_4_33": (4.33, _US_433),
    "standard_4_0": (4.0, _STANDARD),
    "cn_100": (4.0, _CN),
    "au_7": (7.0, _AU_7),
    "kr_4_5": (4.5, _KR_45),
    "custom": (4.0, _CUSTOM),
}
PRESET_IDS = tuple(_PRESETS)
DEFAULT_PRESET = "uoft_4_0"

# Built-in assessment categories; `color` names resolve to theme tokens in the frontend.
BUILTIN_CATEGORIES: list[dict[str, str]] = [
    {"key": "quiz", "name": "Quiz", "color": "blue"},
    {"key": "exam", "name": "Exam", "color": "amber"},
    {"key": "assignment", "name": "Assignment", "color": "emerald"},
    {"key": "project", "name": "Project", "color": "violet"},
    {"key": "lab", "name": "Lab", "color": "cyan"},
    {"key": "presentation", "name": "Presentation", "color": "rose"},
    {"key": "participation", "name": "Participation", "color": "slate"},
]
CATEGORY_COLORS = tuple(c["color"] for c in BUILTIN_CATEGORIES)


def preset_max_points(preset_id: str) -> float:
    return _PRESETS.get(preset_id, _PRESETS[DEFAULT_PRESET])[0]


def preset_bands(preset_id: str) -> list[dict[str, Any]]:
    _, table = _PRESETS.get(preset_id, _PRESETS[DEFAULT_PRESET])
    return [
        {"min": lo, "max": hi, "points": pts, "letter": letter} for lo, hi, pts, letter in table
    ]
