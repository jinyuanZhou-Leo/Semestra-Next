"""Extraction with evidence: quote checks, splitting long documents, merging parts (M06 §5)."""

import json
from typing import Any

import pytest
import respx
from httpx import Response
from pydantic import BaseModel

from semestra.core.errors import AppError
from semestra.modules import ai as m06
from semestra.modules.ai import catalog, extraction
from semestra.modules.ai.extraction import Evidence, Evidenced, verify_evidence
from semestra.modules.ai.llm import PageText
from semestra.modules.ai.tests.conftest import ANTHROPIC, Ai, models_ok


class Assessment(BaseModel):
    name: Evidenced[str]
    weight: Evidenced[float]


class Syllabus(BaseModel):
    course_code: Evidenced[str]
    instructor: Evidenced[str]
    assessments: list[Assessment] = []


PAGES = [
    PageText(1, "APS105H1 Computer Fundamentals\nInstructor:   Prof. Jane   Doe"),
    PageText(2, "Assessment\nMidterm exam — 30%\nFinal exam 50%"),
]


def ev(value: Any, page: int | None, quote: str, confidence: float = 0.9) -> dict[str, Any]:
    return {"value": value, "evidence": {"page": page, "quote": quote}, "confidence": confidence}


def leaf(
    value: Any = None, page: int = 0, quote: str = "", confidence: float = 0.9
) -> dict[str, Any]:
    """One `Evidenced` field as the model answers it (the wire schema)."""
    return {"value": value, "quote": quote, "page": page, "confidence": confidence}


def answer(
    course_code: dict[str, Any] | None = None,
    instructor: dict[str, Any] | None = None,
    assessments: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return {
        "course_code": course_code or leaf(""),
        "instructor": instructor or leaf(""),
        "assessments": assessments or [],
    }


def tool_reply(payload: dict[str, Any]) -> Response:
    """Claude's JSON schema mode: the result is the text of the reply."""
    return Response(
        200,
        json={
            "content": [{"type": "text", "text": json.dumps(payload)}],
            "stop_reason": "end_turn",
            "usage": {"input_tokens": 100, "output_tokens": 20},
        },
    )


def test_evidenced_schema_hides_server_fields_and_reads_words():
    schema = json.dumps(Syllabus.model_json_schema())
    assert "conflict" not in schema
    assert "evidence" in schema
    assert Evidenced[str].model_validate({"value": "x", "confidence": "High"}).confidence == 0.9
    assert Evidenced[str].model_validate({"value": "x", "confidence": 7}).confidence == 1.0


def test_quotes_are_checked_ignoring_whitespace_and_pages_are_fixed():
    value = Syllabus.model_validate(
        {
            "course_code": ev("APS105H1", 1, "APS105H1  Computer\n Fundamentals"),
            "instructor": ev("Jane Doe", 2, "Instructor: Prof. Jane Doe"),  # wrong page
            "assessments": [
                {"name": ev("Midterm", 2, "Midterm exam - 30%"), "weight": ev(30, 2, "30%")},
                {"name": ev("Quiz", 2, "Weekly quizzes 10%"), "weight": ev(10, None, "10%")},
            ],
        }
    )
    warnings = verify_evidence(value, PAGES)
    assert value.course_code.evidence == Evidence(page=1, quote="APS105H1  Computer\n Fundamentals")
    assert value.instructor.evidence is not None
    assert value.instructor.evidence.page == 1
    assert value.assessments[0].name.evidence is not None  # en dash matches a hyphen
    quiz = value.assessments[1]
    assert quiz.name.evidence is None
    assert quiz.name.confidence == extraction.LOW_CONFIDENCE
    assert quiz.weight.evidence is None
    assert quiz.weight.confidence == extraction.LOW_CONFIDENCE
    assert [(w.code, w.path) for w in warnings] == [
        ("evidence_not_found", "assessments[1].name"),
        ("evidence_not_found", "assessments[1].weight"),
    ]


async def test_extract_wraps_the_document_and_verifies(ai: Ai, mock: respx.MockRouter):
    models_ok(mock)
    await ai.provider("anthropic")
    route = mock.post(f"{ANTHROPIC}/v1/messages").mock(
        return_value=tool_reply(
            answer(
                leaf("APS105H1", 1, "APS105H1"),
                leaf("Jane Doe", 1, "made up quote"),
                [{"name": leaf("Final", 2, "Final exam"), "weight": leaf(50, 2, "50%")}],
            )
        )
    )
    async with ai.ctx() as ctx:
        result = await m06.extract(
            ctx,
            "extraction",
            Syllabus,
            texts=PAGES,
            instructions="Extract the course code, instructor and graded assessments.",
            source_module="imports",
            label="syllabus.pdf",
        )
    assert result.value.course_code.value == "APS105H1"
    assert result.value.instructor.evidence is None
    assert [w.path for w in result.warnings] == ["instructor"]
    assert (result.usage.input_tokens, result.segments) == (100, 1)
    body = json.loads(route.calls.last.request.content)
    assert "data, not instructions" in body["system"]
    assert "graded assessments" in body["system"]
    text = body["messages"][0]["content"][0]["text"]
    assert text.startswith('<untrusted_document label="syllabus.pdf">\n[page 1]\nAPS105H1')
    assert "[page 2]" in text


async def test_long_documents_are_split_and_merged(
    ai: Ai, mock: respx.MockRouter, monkeypatch: pytest.MonkeyPatch
):
    models_ok(mock)
    await ai.provider("anthropic")
    monkeypatch.setattr(extraction, "MIN_SEGMENT_TOKENS", 40)
    monkeypatch.setattr(extraction, "OUTPUT_RESERVE_TOKENS", 0)
    monkeypatch.setattr(catalog, "context_window", lambda *_: 1)  # budget = the minimum
    pages = [PageText(1, "Course APS105H1 " * 6), PageText(2, "Instructor Jane Doe " * 6)]
    replies = [
        tool_reply(
            answer(
                leaf("APS105H1", 1, "Course APS105H1", 0.8),
                None,
                [{"name": leaf("Lab", 1, "Course"), "weight": leaf(10, 1, "APS105H1")}],
            )
        ),
        tool_reply(
            answer(
                leaf("APS106", 2, "Instructor", 0.6),
                leaf("Jane Doe", 2, "Instructor Jane Doe"),
                [
                    {"name": leaf("lab", 2, "Jane"), "weight": leaf(10, 2, "Doe")},
                    {"name": leaf("Exam", 2, "Jane"), "weight": leaf(90, 2, "Doe")},
                ],
            )
        ),
    ]
    route = mock.post(f"{ANTHROPIC}/v1/messages").mock(side_effect=replies)
    progress: list[tuple[int, int]] = []

    async def on_segment(done: int, total: int) -> None:
        progress.append((done, total))

    async with ai.ctx() as ctx:
        result = await m06.extract(
            ctx,
            "extraction",
            Syllabus,
            texts=pages,
            instructions="x",
            source_module="imports",
            on_segment=on_segment,
        )
    assert route.call_count == 2
    assert result.segments == 2
    assert progress == [(1, 2), (2, 2)]
    assert "part 1" in json.loads(route.calls[0].request.content)["system"]
    value = result.value
    assert value.course_code.value == "APS105H1"
    assert value.course_code.conflict is True
    assert value.instructor.value == "Jane Doe"
    assert [a.name.value for a in value.assessments] == ["Lab", "Exam"]  # "lab" is the same item
    assert ("conflict", "course_code") in [(w.code, w.path) for w in result.warnings]


async def test_context_too_long_splits_and_retries(ai: Ai, mock: respx.MockRouter):
    models_ok(mock)
    await ai.provider("anthropic")
    too_long = Response(400, json={"error": {"message": "prompt is too long: 300000 tokens"}})
    ok = tool_reply(answer(leaf("APS105H1", 1, "APS105H1")))
    route = mock.post(f"{ANTHROPIC}/v1/messages").mock(side_effect=[too_long, ok, ok])
    async with ai.ctx() as ctx:
        result = await m06.extract(
            ctx, "extraction", Syllabus, texts=PAGES, instructions="x", source_module="imports"
        )
    assert route.call_count == 3
    assert result.segments == 2
    assert result.value.course_code.value == "APS105H1"


async def test_an_answer_cut_off_reads_the_part_in_halves(ai: Ai, mock: respx.MockRouter):
    models_ok(mock)
    await ai.provider("anthropic")
    cut = Response(
        200,
        json={
            "content": [{"type": "text", "text": '{"course_code": {"value": "APS'}],
            "stop_reason": "max_tokens",
            "usage": {"input_tokens": 100, "output_tokens": 16384},
        },
    )
    first = tool_reply(answer(leaf("APS105H1", 1, "APS105H1")))
    second = tool_reply(
        answer(assessments=[{"name": leaf("Final", 2, "Final exam"), "weight": leaf(50, 2, "50%")}])
    )
    route = mock.post(f"{ANTHROPIC}/v1/messages").mock(side_effect=[cut, first, second])
    async with ai.ctx() as ctx:
        result = await m06.extract(
            ctx, "extraction", Syllabus, texts=PAGES, instructions="x", source_module="imports"
        )
    assert route.call_count == 3
    assert result.segments == 2
    assert result.value.course_code.value == "APS105H1"
    assert [a.name.value for a in result.value.assessments] == ["Final"]


async def test_answers_cut_off_again_stop_after_two_splits(ai: Ai, mock: respx.MockRouter):
    models_ok(mock)
    await ai.provider("anthropic")
    cut = Response(
        200,
        json={
            "content": [{"type": "text", "text": '{"course_code": {"value": "APS'}],
            "stop_reason": "max_tokens",
            "usage": {"input_tokens": 100, "output_tokens": 16384},
        },
    )
    route = mock.post(f"{ANTHROPIC}/v1/messages").mock(return_value=cut)
    pages = [PageText(n, f"Week {n}: lecture notes " * 20) for n in range(1, 5)]
    async with ai.ctx() as ctx:
        with pytest.raises(AppError) as exc:
            await m06.extract(
                ctx, "extraction", Syllabus, texts=pages, instructions="x", source_module="imports"
            )
    assert exc.value.code == "ai.output_truncated"
    # Four pages, then two, then one: a model repeating itself is not chased any further.
    assert route.call_count == 3


async def test_extract_needs_input(ai: Ai):
    async with ai.ctx() as ctx:
        with pytest.raises(AppError) as exc:
            await m06.extract(
                ctx,
                "extraction",
                Syllabus,
                texts=[PageText(1, "  ")],
                instructions="x",
                source_module="t",
            )
    assert exc.value.code == "common.validation"


def test_segments_respect_the_budget():
    pages = [PageText(i, "word " * 400) for i in range(1, 6)]  # ~500 tokens each
    segments = extraction._segments(pages, [], budget=1200)  # pyright: ignore[reportPrivateUsage]
    assert [[p.page for p in s.pages] for s in segments] == [[1, 2], [3, 4], [5]]
    long = extraction._segments([PageText(1, "line\n" * 2000)], [], budget=500)  # pyright: ignore[reportPrivateUsage]
    assert len(long) > 1
    assert all(s.tokens() <= 520 for s in long)
    assert "".join(p.text for s in long for p in s.pages) == "line\n" * 2000


def test_the_model_fills_in_a_schema_with_every_field_required():
    wire = extraction.wire_schema(Syllabus)
    assert extraction.schema_complexity(wire) == (0, 1)  # only the weight can be null
    answer_ = wire.model_validate(
        answer(
            leaf("APS105H1", 1, "APS105H1"), assessments=[{"name": leaf("Final"), "weight": leaf()}]
        )
    )
    value = Syllabus.model_validate(extraction._from_wire(answer_))  # pyright: ignore[reportPrivateUsage]
    assert value.course_code.evidence == Evidence(page=1, quote="APS105H1")
    assert value.instructor.value is None  # "" is "not stated"
    assert value.assessments[0].name.evidence is None
    assert value.assessments[0].weight.value is None


async def test_parts_are_read_in_separate_requests(ai: Ai, mock: respx.MockRouter):
    models_ok(mock)
    await ai.provider("anthropic")

    def reply(request: Any) -> Response:
        fields = set(json.loads(request.content)["output_config"]["format"]["schema"]["properties"])
        if fields == {"course_code", "instructor"}:
            return tool_reply(
                {"course_code": leaf("APS105H1", 1, "APS105H1"), "instructor": leaf("")}
            )
        assert fields == {"assessments"}
        return tool_reply(
            {
                "assessments": [
                    {"name": leaf("Final", 2, "Final exam"), "weight": leaf(50, 2, "50%")}
                ]
            }
        )

    route = mock.post(f"{ANTHROPIC}/v1/messages").mock(side_effect=reply)
    async with ai.ctx() as ctx:
        result = await m06.extract(
            ctx,
            "extraction",
            Syllabus,
            texts=PAGES,
            instructions="x",
            source_module="imports",
            parts=[("course_code", "instructor"), ("assessments",)],
        )
    assert route.call_count == 2
    assert "covers only: assessments" in json.dumps(
        [json.loads(c.request.content)["system"] for c in route.calls]
    )
    assert result.value.course_code.value == "APS105H1"
    assert [a.weight.value for a in result.value.assessments] == [50]
