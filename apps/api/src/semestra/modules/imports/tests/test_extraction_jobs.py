"""The extraction job around the model: course files still being processed, passing errors."""

from typing import Any

import pytest
from fastapi import FastAPI
from sqlalchemy import update

from semestra.core.context import system_ctx
from semestra.core.errors import AppError
from semestra.core.events import Event, events
from semestra.modules import ai
from semestra.modules.files.models import FilesItem
from semestra.modules.imports import extraction, jobs
from semestra.modules.imports.tests.test_imports import SYLLABUS, Api


class ModelCalls(list[str]):
    """Each extraction call; error codes in `failures` make the next calls fail."""

    def __init__(self) -> None:
        super().__init__()
        self.failures: list[str] = []


@pytest.fixture
def model_calls(monkeypatch: pytest.MonkeyPatch) -> ModelCalls:
    calls = ModelCalls()

    async def available(ctx: Any, purpose: str) -> bool:
        return True

    async def run_extract(ctx: Any, purpose: str, schema: Any, **kwargs: Any) -> Any:
        calls.append(purpose)
        if calls.failures:
            raise AppError(calls.failures.pop(0), 504)
        return ai.Extraction(value=schema.model_validate(SYLLABUS))

    monkeypatch.setattr(ai, "available", available)
    monkeypatch.setattr(extraction, "run_extract", run_extract)
    monkeypatch.setattr(jobs, "SOURCE_RETRY_SECONDS", 0)
    return calls


async def _course_file(app: FastAPI, api: Api, run_jobs, course_id: str) -> str:
    from semestra.modules.files.tests.conftest import make_pdf

    pdf = make_pdf(["APS105 Computer Fundamentals", "Midterm 30%"])
    r = await api.call(
        "POST",
        f"/courses/{course_id}/files",
        files={"files": ("syllabus.pdf", pdf, "application/pdf")},
    )
    item_id = r["items"][0]["id"]
    await run_jobs()
    return item_id


async def _set_status(app: FastAPI, item_id: str, status: str) -> None:
    async with system_ctx(app.state) as ctx:
        await ctx.db.execute(
            update(FilesItem).where(FilesItem.id == item_id).values(doc_status=status)
        )
        await ctx.db.commit()


async def test_a_course_file_still_processing_is_waited_for(
    app: FastAPI, api: Api, model_calls: ModelCalls, run_jobs
):
    program_id = await api.program()
    term_id = await api.term(program_id)
    course = await api.course(program_id, term_id)
    item_id = await _course_file(app, api, run_jobs, course["id"])
    await _set_status(app, item_id, "processing")
    session = await api.create(
        program_id, source_kind="syllabus",
        target={"kind": "course", "course_id": course["id"], "term_id": term_id},
        file_item_ids=[item_id],
    )  # fmt: skip
    await run_jobs()
    waiting = await api.call("GET", f"/imports/{session['id']}")
    assert waiting["status"] == "extracting"
    assert waiting["source_refs"][0]["status"] == "waiting"
    assert model_calls == []  # nothing read or paid for yet

    await _set_status(app, item_id, "ready")
    me = await api.call("GET", "/account/me")
    await events.dispatch(app.state, Event("files.document.ready", {"item_id": item_id}, me["id"]))
    await run_jobs()
    done = await api.call("GET", f"/imports/{session['id']}")
    assert done["status"] == "ready"
    assert done["source_refs"][0]["status"] == "done"
    assert len(model_calls) == 1


async def test_a_passing_model_error_is_tried_again_for_that_file(
    app: FastAPI, api: Api, model_calls: ModelCalls, run_jobs
):
    program_id = await api.program()
    term_id = await api.term(program_id)
    course = await api.course(program_id, term_id)
    upload = (
        await api.call(
            "POST",
            "/imports/uploads",
            files={"file": ("s.txt", b"APS105 Midterm 30%", "text/plain")},
        )
    )["id"]
    model_calls.failures.append("ai.timeout")
    session = await api.create(
        program_id, source_kind="syllabus",
        target={"kind": "course", "course_id": course["id"], "term_id": term_id},
        upload_ids=[upload],
    )  # fmt: skip
    await run_jobs()
    done = await api.call("GET", f"/imports/{session['id']}")
    assert done["status"] == "ready"
    assert len(model_calls) == 2


async def test_a_category_weight_is_shared_by_its_assessments(
    api: Api, fake_ai: list[dict[str, Any]], run_jobs
):
    from semestra.modules.imports.tests.test_imports import by_type, ev

    fake_ai.append(
        {
            "course": {"code": ev("APS105H1"), "title": ev("Computer Fundamentals")},
            "grading": {
                "categories": [{"name": ev("Quizzes"), "weight": ev(20)}],
                "assessments": [
                    *[{"title": ev(f"Quiz {n}"), "category": ev("Quizzes")} for n in range(1, 5)],
                    {"title": ev("Final exam"), "weight": ev(80)},
                ],
            },
        }
    )
    program_id = await api.program()
    term_id = await api.term(program_id)
    course = await api.course(program_id, term_id)
    upload = (
        await api.call(
            "POST", "/imports/uploads", files={"file": ("s.txt", b"Quizzes 20%", "text/plain")}
        )
    )["id"]
    session = await api.create(
        program_id, source_kind="syllabus",
        target={"kind": "course", "course_id": course["id"], "term_id": term_id},
        upload_ids=[upload],
    )  # fmt: skip
    await run_jobs()
    session = await api.call("GET", f"/imports/{session['id']}")
    quizzes = [a for a in by_type(session, "assessment") if a["data"]["title"].startswith("Quiz")]
    assert [q["data"]["weight"] for q in quizzes] == [5.0] * 4
    assert {q["confidence"]["weight"] for q in quizzes} == {"medium"}
    codes = [i["code"] for item in session["items"] for i in item["issues"]]
    assert "import.weights_not_100" not in codes


async def test_an_edit_can_return_only_the_items_it_touched(
    api: Api, fake_ai: list[dict[str, Any]], run_jobs
):
    from semestra.modules.imports.tests.test_imports import by_type

    program_id = await api.program()
    term_id = await api.term(program_id)
    course = await api.course(program_id, term_id)
    upload = (
        await api.call(
            "POST", "/imports/uploads", files={"file": ("s.txt", b"APS105", "text/plain")}
        )
    )["id"]
    session = await api.create(
        program_id, source_kind="syllabus",
        target={"kind": "course", "course_id": course["id"], "term_id": term_id},
        upload_ids=[upload],
    )  # fmt: skip
    await run_jobs()
    session = await api.call("GET", f"/imports/{session['id']}")
    assessments = {a["data"]["title"]: a for a in by_type(session, "assessment")}
    flagged = next(a for a in assessments.values() if a["issues"])
    final = assessments["Final exam"]
    # 85 + 15 = 100: the weight issue on the first assessment goes away too.
    patched = await api.call(
        "PATCH", f"/imports/{session['id']}/items/{final['id']}",
        json={"data": {"weight": 50}, "only_touched": True},
    )  # fmt: skip
    assert {i["id"] for i in patched["items"]} == {final["id"], flagged["id"]}
    assert patched["summary"] == (await api.call("GET", f"/imports/{session['id']}"))["summary"]
