"""M13 export/import adapter: grade scales, course results, categories and assessments."""

from semestra.modules.grading.models import (
    GradingAssessment,
    GradingCategory,
    GradingCourseResult,
    GradingScale,
)
from semestra.modules.portability import Table, table_adapter

ADAPTER = table_adapter(
    module="grading",
    schema_version=1,
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
