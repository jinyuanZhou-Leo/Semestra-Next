"""M13 export/import adapter: grade scales, course results, categories and assessments."""

from typing import Any

from semestra.modules.grading.models import (
    GradingAssessment,
    GradingCategory,
    GradingCourseResult,
    GradingScale,
)
from semestra.modules.portability import Table, table_adapter
from semestra.modules.portability.registry import OlderArchive


def _v1_to_v2(payload: dict[str, Any], archive: OlderArchive) -> dict[str, Any]:
    """Version 2: the scale's `hide_gpa` is now `hide_grades` (it masks percentages too)."""
    del archive
    scales: list[Any] = []
    for row in payload.get("scales") or []:
        if isinstance(row, dict) and "hide_gpa" in row:
            row = {("hide_grades" if k == "hide_gpa" else k): v for k, v in row.items()}  # pyright: ignore[reportUnknownVariableType, reportUnknownVariableType]
        scales.append(row)  # pyright: ignore[reportUnknownMemberType]
    return {**payload, "scales": scales}


ADAPTER = table_adapter(
    module="grading",
    schema_version=2,
    upgrades={1: _v1_to_v2},
    depends_on=("academics",),
    tables=(
        Table(GradingScale, "scales", refs={"program_id": "required"}),
        Table(
            GradingCourseResult, "course_results", id_column=None, refs={"course_id": "required"}
        ),
        Table(GradingCategory, "categories", refs={"course_id": "required"}),
        Table(
            GradingAssessment,
            "assessments",
            refs={"course_id": "required", "category_id": "optional"},
        ),
    ),
)
