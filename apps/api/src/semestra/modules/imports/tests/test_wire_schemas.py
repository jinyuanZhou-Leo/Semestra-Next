"""Every schema the model fills in stays inside Claude's strict structured output limits."""

import pytest

from semestra.modules.ai.extraction import schema_complexity, wire_schema
from semestra.modules.imports import extraction

# Claude allows 24 optional and 16 nullable properties per request (and a compiled grammar size
# that is not published): keep a margin, since a whole syllabus in one request was refused.
MAX_NULLABLE = 10


@pytest.mark.parametrize(
    ("schema", "fields"),
    [
        *((extraction.SyllabusExtraction, part) for part in extraction.SYLLABUS_PARTS),
        *((extraction.SyllabusExtraction, part) for part in extraction.COURSE_INFO_PARTS),
        (extraction.TimetableExtraction, None),
    ],
)
def test_requests_stay_under_the_structured_output_limits(schema, fields):  # pyright: ignore[reportMissingParameterType, reportUnknownParameterType]
    optional, nullable = schema_complexity(wire_schema(schema, fields))  # pyright: ignore[reportUnknownArgumentType]
    assert optional == 0
    assert nullable <= MAX_NULLABLE


def test_the_parts_cover_the_whole_syllabus():
    asked = {name for part in extraction.SYLLABUS_PARTS for name in part}
    assert asked == set(extraction.SyllabusExtraction.model_fields)
