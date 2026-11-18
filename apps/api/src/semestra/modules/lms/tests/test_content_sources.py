"""Where Sem reads a linked course's content from (M09 §8): a page or file the course's files have
is searched and read there and cited like any file; what they don't have comes from the
platform, saying so; announcements and the teacher's kept feedback are found and read without
the platform."""

import inspect
from datetime import UTC, datetime
from typing import Any

import pytest

from semestra.modules.lms.errors import lms_error
from semestra.modules.lms.schemas.dto import (
    InternalRef,
    Module,
    ModuleItem,
    PageSummary,
    SubmissionComment,
    SubmissionDetail,
)
from semestra.modules.lms.tests.conftest import Api, FakeProvider
from semestra.modules.lms.tests.test_lms import setup_program
from semestra.modules.lms.tests.test_sync import _course

pytestmark = pytest.mark.usefixtures("fake")

JAN = datetime(2026, 1, 10, tzinfo=UTC)
POLICIES = "<p>Late work loses 10% per day, up to three days. Labs are worth 20%.</p>"


def _policies_page(fake: FakeProvider) -> None:
    fake.module_list = [
        Module(
            external_id="m1",
            name="Week 1",
            items=[
                ModuleItem(
                    external_id="i1",
                    title="Course policies",
                    kind="page",
                    position=1,
                    target=InternalRef(kind="page", ref="policies"),
                )
            ],
        )
    ]
    fake.page_list = [
        PageSummary(external_id="p1", ref="policies", title="Course policies", updated_at=JAN)
    ]
    fake.page_texts = {"policies": ("Course policies", POLICIES)}


async def _linked(api: Api, *, materials: bool) -> str:
    program_id, term_id, _ = await setup_program(api)
    course = await api.course(program_id, term_id)
    await api.link(course, "101")
    if not materials:
        body = {"scope_type": "course", "scope_id": course, "values": {"sync": False}}
        await api.call("PATCH", "/me/settings/lms.materials", json=body)
    await api.sync(program_id)
    return course


async def _search(api: Api, course: str, query: str) -> dict[str, Any]:
    return await api.call("GET", f"/courses/{course}/lms/search", params={"query": query})


async def _read(api: Api, course: str, ref: str, **params: Any) -> dict[str, Any]:
    params["ref"] = ref
    return await api.call("GET", f"/courses/{course}/lms/content", params=params)


def _platform_down(fake: FakeProvider) -> None:
    """Every request to the platform fails, as when it can't be reached."""

    async def unreachable(*args: Any, **kwargs: Any) -> Any:
        del args, kwargs
        raise lms_error("lms.unreachable")

    for name, _ in inspect.getmembers(FakeProvider, inspect.iscoroutinefunction):
        if not name.startswith("_"):
            setattr(fake, name, unreachable)


async def test_a_page_the_course_files_have_is_searched_and_read_there(
    api: Api, fake: FakeProvider
):
    _policies_page(fake)
    course = await _linked(api, materials=True)
    fake.calls.clear()

    found = await _search(api, course, "late work")
    pages = [h for h in found["hits"] if h["ref"] == "page:policies"]
    assert len(pages) == 1  # one hit, from the course files
    hit = pages[0]
    assert hit["item_id"]
    assert hit["citation_id"].startswith(f"{hit['item_id']}:p")
    assert "Late work loses 10%" in hit["snippet"]
    assert hit["where"] == "Week 1"
    assert [c["id"] for c in found["citations"]] == [hit["citation_id"]]

    read = await _read(api, course, "page:policies")
    assert read["item_id"] == hit["item_id"]
    assert "Late work loses 10%" in read["text"]
    assert [c["item_id"] for c in read["citations"]] == [hit["item_id"]]
    # Neither asked the platform for the page again.
    assert ("page", "policies") not in fake.calls

    outline = await api.call("GET", f"/courses/{course}/lms/outline")
    assert outline["modules"][0]["items"][0]["item_id"] == hit["item_id"]


async def test_with_the_materials_sync_off_pages_come_from_the_platform(
    api: Api, fake: FakeProvider
):
    _policies_page(fake)
    course = await _linked(api, materials=False)

    found = await _search(api, course, "late work")
    hit = next(h for h in found["hits"] if h["ref"] == "page:policies")
    assert (hit["item_id"], hit["citation_id"]) == (None, None)
    assert "Late work loses 10%" in hit["snippet"]
    assert found["citations"] == []

    read = await _read(api, course, "page:policies")
    assert read["item_id"] is None
    assert "Late work loses 10%" in read["text"]
    assert read["note"].startswith("Not in the course files")


async def test_announcements_and_feedback_are_read_without_the_platform(
    api: Api, fake: FakeProvider
):
    program_id, course = await _course(api, "a1")
    note = SubmissionComment(id="1", author="Prof", comment="Check your loop bounds")
    fake.course_submissions["101"] = [
        SubmissionDetail(external_id="s-a1", assignment_id="a1", comments=[note], score=9)
    ]
    await api.sync(program_id)
    _platform_down(fake)

    found = await _search(api, course, "welcome")
    assert [h["ref"] for h in found["hits"]] == ["announcement:n101"]
    assert found["skipped"][-1]["reason"] == "lms.unreachable"
    read = await _read(api, course, "announcement:n101")
    assert read["title"] == "Welcome"
    assert "Hi" in read["text"]
    assert read["note"] == "Its replies could not be read from the LMS."

    found = await _search(api, course, "loop bounds")
    hit = found["hits"][0]
    assert (hit["ref"], hit["title"], hit["where"]) == ("assignment:a1", "Lab 1", "Feedback")
    for refresh in (False, True):  # the assignment as read lately, or none at all
        read = await _read(api, course, "assignment:a1", refresh=refresh)
        assert "Check your loop bounds" in read["text"]
        assert "Score 9/10" in read["text"]
    assert read["note"].startswith("The LMS could not give the assignment")
