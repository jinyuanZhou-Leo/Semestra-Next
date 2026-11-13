"""Gradebook, grading scale and summaries (M03). Capabilities stay thin and call into here.

All arithmetic lives in `engine.py`; these modules load rows (through the academics service for
anything that module owns), call the engine and shape the results. Split by subject: `scales`,
`courses` (loading and first-use setup), `categories`, `assessments`, `gradebook` (one course:
result, gradebook, what-if) and `summaries` (term, Program and course summaries).
"""

from semestra.modules.grading.service.assessments import (
    AssessmentSnapshot,
    assessment_snapshots,
    category_keys,
    counted_weights,
    create_assessments,
    delete_assessment,
    delete_assessments,
    find_assessment_rows,
    find_assessments,
    list_assessments,
    preview_assessment_delete,
    preview_assessment_update,
    preview_assessments_delete,
    preview_assessments_update,
    preview_category_delete,
    scored_counts,
    set_source,
    upcoming_assessments,
    update_assessment,
    update_assessments,
)
from semestra.modules.grading.service.categories import (
    course_categories,
    create_category,
    delete_category,
    reorder_categories,
    update_category,
)
from semestra.modules.grading.service.common import program_courses
from semestra.modules.grading.service.courses import (
    delete_course_data,
    delete_program_data,
    ensure_course_setup,
)
from semestra.modules.grading.service.gradebook import (
    get_gradebook,
    simulate_course,
    suggest_scores,
    update_result,
)
from semestra.modules.grading.service.scales import (
    create_scale,
    get_scale_row,
    list_presets,
    scale_out,
    update_scale,
)
from semestra.modules.grading.service.summaries import (
    course_grades,
    program_grades,
    simulate_term,
    term_grades,
)

__all__ = [
    "AssessmentSnapshot",
    "assessment_snapshots",
    "category_keys",
    "counted_weights",
    "course_categories",
    "course_grades",
    "create_assessments",
    "create_category",
    "create_scale",
    "delete_assessment",
    "delete_assessments",
    "delete_category",
    "delete_course_data",
    "delete_program_data",
    "ensure_course_setup",
    "find_assessment_rows",
    "find_assessments",
    "get_gradebook",
    "get_scale_row",
    "list_assessments",
    "list_presets",
    "preview_assessment_delete",
    "preview_assessment_update",
    "preview_assessments_delete",
    "preview_assessments_update",
    "preview_category_delete",
    "program_courses",
    "program_grades",
    "reorder_categories",
    "scale_out",
    "scored_counts",
    "set_source",
    "simulate_course",
    "simulate_term",
    "suggest_scores",
    "term_grades",
    "upcoming_assessments",
    "update_assessment",
    "update_assessments",
    "update_category",
    "update_result",
    "update_scale",
]
