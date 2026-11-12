"""The assistant's LMS tools (M09 §8): outline, search, read and activity, over the fake
provider. They are reached here over HTTP, which they also offer."""

from datetime import datetime
from typing import Any

from fastapi import FastAPI

from semestra.core.capability import registry
from semestra.core.context import Ctx, run_as_system
from semestra.modules.academics import service as academics
from semestra.modules.lms import previews
from semestra.modules.lms import search as ranking
from semestra.modules.lms.errors import lms_error
from semestra.modules.lms.schemas.dto import (
    InternalRef,
    Module,
    ModuleItem,
    NavTab,
    Submission,
)
from semestra.modules.lms.schemas.io import AssignmentImportInput
from semestra.modules.lms.tests.conftest import Api, FakeProvider
from semestra.modules.lms.tests.test_lms import setup_program

AGENT_TOOLS = {
    "lms.content.search", "lms.content.read", "lms.course.outline", "lms.activity.list",
    "lms.assignment.list", "lms.course.list", "lms.course.link.set", "lms.file.save_to_course",
    "lms.course.import", "lms.assignment.import", "lms.syllabus.import",
    "lms.assignment.bind", "lms.assignment.unbind",
}  # fmt: skip


def _page(slug: str, title: str) -> ModuleItem:
    return ModuleItem(
        external_id=f"i-{slug}", title=title, kind="page", target=InternalRef(kind="page", ref=slug)
    )


def _course_like_mat291(fake: FakeProvider) -> None:
    """Pages hidden by the instructor, a recording link deep in a page's text, a long slug."""
    long_slug = "week-8-" + "calculus-of-surfaces-" * 10
    fake.nav = [
        NavTab(external_id="home", kind="home", label="Home"),
        NavTab(external_id="modules", kind="modules", label="Modules"),
        NavTab(external_id="ext", kind="external", label="Panopto", web_url="https://fake/tool"),
    ]
    fake.pages_hidden = True
    fake.module_list = [
        Module(external_id="m1", name="Weekly Lecture Content", items=[_page(long_slug, "Week 8")]),
        Module(
            external_id="m2",
            name="Core Course Reference Material",
            items=[
                _page("class-notes-lec0103", "Class Notes LEC0103 & 0104"),
                ModuleItem(
                    external_id="i-x",
                    title="Formula sheet",
                    kind="file",
                    target=InternalRef(kind="file", ref="77"),
                ),
                ModuleItem(
                    external_id="i-y",
                    title="Textbook site",
                    kind="external_url",
                    external_url="https://book.example",
                ),
            ],
        ),
    ]
    fake.page_texts = {
        long_slug: ("Week 8", "<p>Flux integrals and the divergence theorem.</p>"),
        "class-notes-lec0103": (
            "Class Notes LEC0103 & 0104",
            "<p><b>Lecture Recordings are available "
            '<a href="https://www.youtube.com/playlist?list=PL1">here</a>.</b></p>'
            "<table><tr><td>Lecture 1</td><td>Course Logistics</td></tr></table>",
        ),
    }


async def _linked(api: Api) -> tuple[str, str]:
    program_id, term_id, _ = await setup_program(api)
    course = await api.course(program_id, term_id)
    await api.link(course, "101")
    return course, term_id


async def test_only_task_level_lms_tools_reach_agents(app: FastAPI):
    del app  # registers the modules
    agent = {c.name for c in registry.list("agent") if c.name.startswith("lms.")}
    mcp = {c.name for c in registry.list("mcp") if c.name.startswith("lms.")}
    assert agent == AGENT_TOOLS
    assert mcp == AGENT_TOOLS


async def test_search_finds_text_in_pages_the_instructor_hid(api: Api, fake: FakeProvider):
    _course_like_mat291(fake)
    course, _ = await _linked(api)
    found = await api.call(
        "GET", f"/courses/{course}/lms/search", params={"query": "lecture recording"}
    )
    top = found["hits"][0]
    assert (top["ref"], top["kind"], top["where"]) == (
        "page:class-notes-lec0103", "page", "Core Course Reference Material",
    )  # fmt: skip
    assert "Lecture Recordings are available" in top["snippet"]
    # The hidden pages list is not asked for; each page still is.
    assert ("pages", "101") not in fake.calls
    assert {"source": "pages", "reason": "hidden"} in found["skipped"]
    # A second search reads the pages from the cache.
    fake.calls.clear()
    await api.call("GET", f"/courses/{course}/lms/search", params={"query": "flux"})
    assert not [c for c in fake.calls if c[0] == "page"]


async def test_search_covers_announcements_assignments_and_links(api: Api, fake: FakeProvider):
    _course_like_mat291(fake)
    fake.nav.append(NavTab(external_id="discussions", kind="discussions", label="Discussions"))
    course, _ = await _linked(api)

    async def first(query: str, **params: Any) -> dict[str, Any]:
        out = await api.call(
            "GET", f"/courses/{course}/lms/search", params={"query": query, **params}
        )
        return out["hits"][0]

    assert (await first("welcome"))["ref"] == "announcement:n101"
    assert (await first("midterm"))["ref"] == "assignment:a3"
    link = await first("textbook")
    assert (link["kind"], link["ref"], link["url"]) == ("link", None, "https://book.example")
    assert (await first("study group"))["ref"] == "discussion:d1"
    files = await api.call("GET", f"/courses/{course}/lms/search", params={"query": "notes"})
    assert {"source": "files", "reason": "hidden"} in files["skipped"]  # not in the menu
    only = await api.call(
        "GET", f"/courses/{course}/lms/search", params={"query": "lab", "kinds": ["page"]}
    )
    assert only["hits"] == []


async def test_outline_shows_modules_items_and_what_is_open(api: Api, fake: FakeProvider):
    _course_like_mat291(fake)
    course, _ = await _linked(api)
    out = await api.call("GET", f"/courses/{course}/lms/outline")
    assert out["open_areas"] == ["home", "modules"]
    assert out["external_tabs"] == [{"label": "Panopto", "url": "https://fake/tool"}]
    [weekly, core] = out["modules"]
    assert weekly["items"][0]["ref"].startswith("page:week-8-")
    assert [(i["kind"], i["ref"], i["url"]) for i in core["items"][1:]] == [
        ("file", "file:77", None),
        ("external_url", None, "https://book.example"),
    ]
    assert out["other_pages"] == []


async def test_outline_fills_in_items_and_lists_pages_outside_modules(api: Api, fake: FakeProvider):
    course, _ = await _linked(api)
    out = await api.call("GET", f"/courses/{course}/lms/outline")
    # Week 2 came without its items: they were asked for.
    assert [m["name"] for m in out["modules"]] == ["Week 1", "Week 2"]
    assert out["modules"][1]["items"][0]["ref"] == "page:intro"
    assert ("module_items", "m2") in fake.calls
    assert out["open_areas"] == ["home"]
    assert out["other_pages"] == []  # intro is in Week 2


async def test_read_takes_any_ref_or_address(api: Api, fake: FakeProvider):
    _course_like_mat291(fake)
    course, _ = await _linked(api)

    async def read(**params: Any) -> dict[str, Any]:
        return await api.call("GET", f"/courses/{course}/lms/content", params=params)

    week8 = next(iter(fake.page_texts))
    page = await read(ref=f"page:{week8}")  # longer than any id the old tools took
    assert (page["kind"], page["title"]) == ("page", "Week 8")
    assert "divergence theorem" in page["text"]
    by_url = await read(url="https://fake/courses/101/pages/class-notes-lec0103")
    assert by_url["ref"] == "page:class-notes-lec0103"
    assert "playlist" in by_url["text"]
    syllabus = await read(ref="syllabus")
    assert "midterm 80%" in syllabus["text"]
    topic = await read(ref="discussion:d1")
    assert "Bo" in topic["text"]
    note = await read(ref="announcement:n101")
    assert (note["kind"], note["title"]) == ("announcement", "Welcome")
    bad = await api.call("GET", f"/courses/{course}/lms/content", 422, params={"ref": "module:3"})
    assert bad["error"]["code"] == "lms.invalid_ref"
    missing = await api.call(
        "GET", f"/courses/{course}/lms/content", 404, params={"ref": "assignment:nope"}
    )
    assert missing["error"]["code"] == "lms.not_found"


async def test_read_an_assignment_with_score_rubric_and_feedback(api: Api, fake: FakeProvider):
    course, _ = await _linked(api)
    lab = fake.course_assignments["101"][0]
    lab.submission = Submission(state="graded", score=8, grade="B")
    out = await api.call("GET", f"/courses/{course}/lms/content", params={"ref": "assignment:a1"})
    assert out["points"] == 10
    assert "Your submission: graded, score 8/10 (B)" in out["text"]
    assert "**Prof**: Good work" in out["text"]


async def test_read_goes_on_from_an_offset(api: Api, fake: FakeProvider):
    course, _ = await _linked(api)
    fake.page_texts = {"long": ("Long", "<p>" + "word " * 6000 + "</p>")}
    first = await api.call("GET", f"/courses/{course}/lms/content", params={"ref": "page:long"})
    assert first["next_offset"] == 20_000
    rest = await api.call(
        "GET", f"/courses/{course}/lms/content", params={"ref": "page:long", "offset": 20_000}
    )
    assert rest["next_offset"] is None
    assert len(first["text"]) + len(rest["text"]) > 29_000


async def test_assignment_list_filters_and_gives_refs(api: Api, fake: FakeProvider):
    course, _ = await _linked(api)
    fake.course_assignments["101"][0].submission = Submission(state="graded", score=9)
    graded = await api.call(
        "GET", f"/courses/{course}/lms/assignments",
        params={"status": "graded", "include_total": True},
    )  # fmt: skip
    assert [(a["ref"], a["name"]) for a in graded["items"]] == [("assignment:a1", "Lab 1")]
    assert graded["totals"][0]["score"] == 91.5
    later = await api.call(
        "GET", f"/courses/{course}/lms/assignments", params={"due_after": "2026-02-15T00:00:00Z"}
    )
    assert [a["name"] for a in later["items"]] == ["Lab 2", "Midterm"]
    assert later["totals"] == []


async def test_import_takes_refs_and_moves_tasks_into_the_gradebook(api: Api, fake: FakeProvider):
    course, _ = await _linked(api)
    fake.course_assignments["101"][0].points = None  # becomes a to-do
    started = await api.call(
        "POST", f"/courses/{course}/lms/imports:assignments",
        json={"external_ids": ["assignment:a1"]},
    )  # fmt: skip
    if not started["committed"]:
        await api.commit(started["session_id"])
    listed = await api.call("GET", f"/courses/{course}/lms/assignments")
    assert listed["items"][0]["imported_as"]["kind"] == "task"
    fake.course_assignments["101"][0].points = 10
    moved = await api.call(
        "POST", f"/courses/{course}/lms/imports:assignments",
        json={"external_ids": ["assignment:a1"], "into": "gradebook"},
    )  # fmt: skip
    if not moved["committed"]:
        await api.commit(moved["session_id"])
    listed = await api.call("GET", f"/courses/{course}/lms/assignments")
    assert listed["items"][0]["imported_as"]["kind"] == "assessment"


async def test_activity_lists_what_is_new_across_a_term(api: Api, fake: FakeProvider):
    course, term_id = await _linked(api)
    fake.course_assignments["101"][0].submission = Submission(
        state="graded", score=9, graded_at=datetime.fromisoformat("2026-01-20T12:00:00+00:00")
    )
    since = "2026-01-01T00:00:00Z"
    out = await api.call("GET", "/me/lms/activity", params={"term_id": term_id, "since": since})
    kinds = {(i["kind"], i["ref"]) for i in out["items"]}
    assert ("grade", "assignment:a1") in kinds
    assert ("assignment", "assignment:a1") in kinds  # changed since, not imported
    assert all(i["course_id"] == course and i["course"] == "APS105H1" for i in out["items"])
    one = await api.call("GET", "/me/lms/activity", params={"course_id": course, "since": since})
    assert one["items"] == out["items"]


async def test_course_find_says_which_courses_are_on_the_lms(
    api: Api, app: FastAPI, fake: FakeProvider
):
    del fake
    program_id, term_id, _ = await setup_program(api)
    linked = await api.course(program_id, term_id)
    await api.course(program_id, term_id, code="APS106H1", title="Fundamentals 2")
    await api.link(linked, "101")
    user_id = (await api.call("GET", "/account/me"))["id"]
    found: list[Any] = []

    async def find(ctx: Ctx) -> None:
        found.extend((await academics.find_courses(ctx, "APS10", program_id, 5)).items)

    await run_as_system(app.state, user_id, find)
    assert {(c.course_id == linked, tuple(c.sources)) for c in found} == {
        (True, ("lms",)),
        (False, ()),
    }


def test_ranking_counts_terms_then_weight():
    title_only = ranking.Doc("a", "Lecture recordings", "")
    text_only = ranking.Doc("b", "Week 1", "The lecture recording is on YouTube")
    one_term = ranking.Doc("c", "Lecture 3", "")
    ranked = sorted(
        (d for d in (one_term, text_only, title_only) if ranking.rank("lecture recording", d)),
        key=lambda d: ranking.order_key(ranking.rank("lecture recording", d), None),  # pyright: ignore[reportArgumentType]
    )
    assert [d.key for d in ranked] == ["a", "b", "c"]
    assert ranking.terms("录播 链接 Quiz") == ["录播", "链接", "quiz"]
    assert ranking.rank("录播", ranking.Doc("d", "课程录播", "")) is not None
    long = "x " * 200 + "the needle is here " + "y " * 200
    cut = ranking.snippet(long, long.index("needle"))
    assert "needle" in cut
    assert cut.startswith("…")
    assert cut.endswith("…")


async def test_times_without_an_offset_are_the_programs(api: Api, fake: FakeProvider):
    course, term_id = await _linked(api)
    later = await api.call(
        "GET", f"/courses/{course}/lms/assignments", params={"due_after": "2026-02-15"}
    )
    assert [a["name"] for a in later["items"]] == ["Lab 2", "Midterm"]
    out = await api.call(
        "GET", "/me/lms/activity", params={"term_id": term_id, "since": "2026-01-01T00:00:00"}
    )
    assert out["since"].startswith("2026-01-01T00:00:00")  # Toronto midnight, not UTC
    assert out["since"] != "2026-01-01T00:00:00Z"


async def test_missing_follows_the_platform_and_skips_work_handed_in_elsewhere(
    api: Api, fake: FakeProvider
):
    course, _ = await _linked(api)
    lab1, lab2, midterm = fake.course_assignments["101"]
    for a in (lab1, lab2, midterm):  # all past due (the clock says 2026-01-15)
        a.due_at = datetime.fromisoformat("2026-01-10T12:00:00+00:00")
    lab1.submission = Submission(state="unsubmitted", missing=True)
    lab2.submission = Submission(state="unsubmitted", missing=False)  # excused, say
    midterm.submission_types = ["on_paper"]
    out = await api.call("GET", f"/courses/{course}/lms/assignments", params={"status": "missing"})
    assert [a["name"] for a in out["items"]] == ["Lab 1"]


async def test_a_refusal_is_a_hidden_area_only_when_the_menu_says_so(
    api: Api, fake: FakeProvider, monkeypatch: Any
):
    fake.nav.append(NavTab(external_id="pages", kind="pages", label="Pages"))
    course, _ = await _linked(api)

    async def refused(*_: Any) -> Any:
        raise lms_error("lms.forbidden")  # dropped from the course, say

    monkeypatch.setattr(type(fake), "pages", refused)
    err = await api.call("GET", f"/courses/{course}/lms/pages", 403)
    assert err["error"]["code"] == "lms.forbidden"


async def test_links_into_other_courses_stay_links(api: Api, fake: FakeProvider):
    course, _ = await _linked(api)
    fake.page_texts = {
        "hub": (
            "Hub",
            '<p><a href="https://fake/courses/101/pages/intro">here</a> '
            '<a href="https://fake/courses/999/pages/intro">there</a> '
            '<a href="https://fake/courses/101/modules/3">week</a></p>',
        )
    }
    out = await api.call("GET", f"/courses/{course}/lms/content", params={"ref": "page:hub"})
    assert "[here](lms:page:intro)" in out["text"]
    assert "(https://fake/courses/999/pages/intro)" in out["text"]
    assert "lms:module" not in out["text"]
    other = await api.call(
        "GET", f"/courses/{course}/lms/content", 422,
        params={"url": "https://fake/courses/999/pages/intro"},
    )  # fmt: skip
    assert other["error"]["code"] == "lms.other_course"


async def test_the_canvas_tab_opens_pages_with_long_slugs(api: Api, fake: FakeProvider):
    course, _ = await _linked(api)
    slug = "week-8-" + "calculus-of-surfaces-" * 12
    page = await api.call("GET", f"/courses/{course}/lms/pages/{slug}")
    assert page["ref"] == slug


async def test_moving_tasks_into_the_gradebook_counts_them_on_the_card(
    api: Api, app: FastAPI, fake: FakeProvider
):
    course, _ = await _linked(api)
    fake.course_assignments["101"][0].points = None
    started = await api.call(
        "POST", f"/courses/{course}/lms/imports:assignments", json={"external_ids": ["a1"]}
    )
    if not started["committed"]:
        await api.commit(started["session_id"])
    user_id = (await api.call("GET", "/account/me"))["id"]
    cards: list[dict[str, Any]] = []

    async def preview(ctx: Ctx) -> None:
        inp = AssignmentImportInput(course_id=course, external_ids=["a1"], into="gradebook")
        cards.append(await previews.preview_assignment_import(ctx, inp))

    await run_as_system(app.state, user_id, preview)
    [change] = cards[0]["changes"]
    assert change["after"] in (["Lab 1"], 1)  # was 0: it counted only what was never imported
