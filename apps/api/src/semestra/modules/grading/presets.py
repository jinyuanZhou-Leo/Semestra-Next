"""Built-in grading scales and category templates (M03 §2)."""

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
# "custom" starts from a single catch-all band for the user to split up.
_CUSTOM = [(0, 100, 0.0, None)]

PRESET_IDS = ("uoft_4_0", "us_4_0", "cn_100", "custom")
DEFAULT_PRESET = "uoft_4_0"
_TABLES = {"uoft_4_0": _UOFT, "us_4_0": _US, "cn_100": _CN, "custom": _CUSTOM}

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


def preset_bands(preset_id: str) -> list[dict[str, Any]]:
    table = _TABLES.get(preset_id, _TABLES[DEFAULT_PRESET])
    return [
        {"min": lo, "max": hi, "points": pts, "letter": letter} for lo, hi, pts, letter in table
    ]
