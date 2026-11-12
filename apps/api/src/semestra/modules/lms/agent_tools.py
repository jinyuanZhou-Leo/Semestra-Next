"""The assistant's LMS tools (M09 §8): a few task-level reads instead of one per platform
endpoint. The Canvas tab keeps the endpoint-level reads (`capabilities.py`, HTTP only)."""

from semestra.core.capability import Http, capability
from semestra.core.context import Ctx
from semestra.modules.lms import content
from semestra.modules.lms.schemas.agent import (
    LmsActivityInput,
    LmsActivityList,
    LmsContentDetail,
    LmsCourseOutline,
    LmsOutlineInput,
    LmsReadInput,
    LmsSearchInput,
    LmsSearchResults,
)

TAGS = ("lms",)
AGENTS = ("http", "agent", "mcp")


@capability(
    name="lms.course.outline",
    summary="A course on the LMS (Canvas) at a glance: its modules with every item, in order.",
    description="""Each item has a `ref` to read it with lms.content.read (external links and
tools have a `url` instead), and says whether it is locked and why. `open_areas` lists the areas
of the course open to the user; the instructor may hide some (pages, files...), and their items
are then reachable only through the modules. Pages in no module are in `other_pages`. Use it to
see what a course has; to find something specific, lms.content.search is faster.""",
    effect="read",
    http=Http("GET", "/courses/{course_id}/lms/outline"),
    expose=AGENTS,
    tags=TAGS,
)
async def course_outline(ctx: Ctx, inp: LmsOutlineInput) -> LmsCourseOutline:
    return await content.outline(ctx, inp)


@capability(
    name="lms.content.search",
    untrusted=True,
    summary="Search everything in a course on the LMS (Canvas): pages, announcements, "
    "assignments, quizzes, discussions, the syllabus, files and links, titles and full text.",
    description="""Use first when looking for something in the course's LMS (a link, a date, a
policy, where the slides are). Words are matched, not meanings: search in the course's
language and try other words before concluding it is not there. Each hit has a `ref` for
lms.content.read and a snippet; `skipped` says what could not be searched (an area the
instructor hid, a limit).""",
    effect="read",
    http=Http("GET", "/courses/{course_id}/lms/search"),
    expose=AGENTS,
    tags=TAGS,
)
async def content_search(ctx: Ctx, inp: LmsSearchInput) -> LmsSearchResults:
    return await content.search(ctx, inp)


@capability(
    name="lms.content.read",
    untrusted=True,
    summary="Read one item of a course on the LMS (Canvas) in full, as Markdown.",
    description="""Takes a `ref` from any lms tool (a page, announcement with its replies,
assignment with the user's score, rubric and the teacher's comments, quiz, discussion, file's
text, `syllabus`) or the item's address on the LMS as `url`. A long text comes in parts: call
again with `next_offset`. Links in the text written `lms:<ref>` open with this tool.""",
    effect="read",
    http=Http("GET", "/courses/{course_id}/lms/content"),
    expose=AGENTS,
    tags=TAGS,
)
async def content_read(ctx: Ctx, inp: LmsReadInput) -> LmsContentDetail:
    return await content.read(ctx, inp)


@capability(
    name="lms.activity.list",
    untrusted=True,
    summary="What is new on the LMS (Canvas) for a course or a whole term: announcements, "
    "grades and new assignments.",
    description="""Newest first, the last 7 days unless `since`. Imported assignments follow the
LMS by themselves (due date, weight, grade); what the user and the LMS both changed waits for the
user in the app's sync panel. Read an item in full with lms.content.read.""",
    effect="read",
    http=Http("GET", "/me/lms/activity"),
    expose=AGENTS,
    tags=TAGS,
)
async def activity_list(ctx: Ctx, inp: LmsActivityInput) -> LmsActivityList:
    return await content.activity(ctx, inp)
