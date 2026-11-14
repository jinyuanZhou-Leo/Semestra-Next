"""M13 export/import adapter: grade scales, course results, categories and assessments.

Version 2 names a scale's switch `hide_grades` (it hides every grade figure, migration 0047);
version 1 (up to 2.0 beta) called it `hide_gpa`, and `_v1_to_v2` renames it.
"""

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
    scales = [
        {
            **{k: v for k, v in scale.items() if k != "hide_gpa"},
            "hide_grades": scale.get("hide_gpa", False),
        }
        if isinstance(scale, dict)
        else scale
        for scale in payload.get("scales") or []
    ]
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
