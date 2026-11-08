"""Inputs and outputs of the assistant's LMS tools (M09 §8): the course outline, searching the
course's content, reading any item by its ref, and what is new. They return Markdown (`text`,
`snippet`) and refs (`<kind>:<id>`, see `refs.py`) instead of the platform's HTML and ids."""

from datetime import datetime
from typing import Annotated, Literal, Self

from pydantic import BaseModel, Field, model_validator

from semestra.modules.academics.schemas import Id

ContentKind = Literal[
    "page", "announcement", "assignment", "quiz", "discussion", "file", "syllabus", "link"
]
# A ref as the tools hand it out: `page:<slug>` can be as long as the platform's page title.
RefStr = Annotated[str, Field(min_length=3, max_length=600)]

_REFRESH = (
    "Ask the LMS again instead of using what was read in the last minutes; only when the user "
    "says something just changed there"
)


class LmsOutlineInput(BaseModel):
    course_id: Id = Field(description="Course id (linked to the LMS)")
    cursor: str | None = Field(
        default=None, max_length=20, description="`next_cursor` of the previous call"
    )
    refresh: bool = Field(default=False, description=_REFRESH)


class LmsOutlineItem(BaseModel):
    title: str
    kind: str = Field(
        description="page, assignment, quiz, file, discussion, external_url, external_tool or "
        "subheader"
    )
    ref: str | None = Field(default=None, description="Read it with lms.content.read")
    url: str | None = Field(
        default=None,
        description="Where an external link or tool leads; such items can't be read, give the "
        "user the link",
    )
    indent: int = 0
    due_at: datetime | None = None
    points: float | None = None
    locked: bool = False
    lock_explanation: str | None = None
    completed: bool | None = Field(
        default=None, description="Whether the user did what the module asks (null: nothing)"
    )


class LmsOutlineModule(BaseModel):
    name: str
    state: str | None = Field(default=None, description="locked, unlocked, started or completed")
    unlock_at: datetime | None = None
    items: list[LmsOutlineItem]


class LmsOutlinePage(BaseModel):
    ref: str
    title: str
    updated_at: datetime | None = None
    front_page: bool = False


class LmsOutlineTab(BaseModel):
    label: str
    url: str | None = None


class LmsCourseOutline(BaseModel):
    course_id: str
    code: str | None = None
    name: str
    term: str | None = None
    provider_name: str
    open_areas: list[str] | None = Field(
        description="Areas of the course open to the user (pages, files, quizzes...); hidden "
        "ones are left out, their items may still be in the modules. Null: not known"
    )
    external_tabs: list[LmsOutlineTab] = Field(
        default_factory=list,
        description="Tools the course links in its menu (recordings, forums...): links only",
    )
    modules: list[LmsOutlineModule]
    other_pages: list[LmsOutlinePage] = Field(
        default_factory=list, description="Pages that are in no module"
    )
    next_cursor: str | None = Field(
        default=None, description="More modules follow: call again with this cursor"
    )


class LmsSearchInput(BaseModel):
    course_id: Id = Field(description="Course id (linked to the LMS)")
    query: str = Field(
        min_length=1,
        max_length=200,
        description="Words to find, in the language of the course (titles and full text are "
        "searched; try other words before giving up)",
    )
    kinds: list[ContentKind] | None = Field(
        default=None, description="Only these kinds of content (default: all)"
    )
    limit: int = Field(default=10, ge=1, le=30, description="Hits to return at most")
    refresh: bool = Field(default=False, description=_REFRESH)


class LmsSearchHit(BaseModel):
    ref: str | None = Field(description="Read it with lms.content.read (null for a link)")
    kind: ContentKind
    title: str
    where: str | None = Field(default=None, description="The module or area it is in")
    snippet: str = Field(description="The text around the match, as Markdown")
    url: str | None = Field(default=None, description="Its address (a link's target)")
    date: datetime | None = Field(default=None, description="Posted, due or last changed")


class LmsSkipped(BaseModel):
    source: str
    reason: str = Field(description="hidden (the instructor hid it), failed, or limit")


class LmsSearchResults(BaseModel):
    hits: list[LmsSearchHit] = Field(description="Best match first")
    skipped: list[LmsSkipped] = Field(
        default_factory=list, description="What could not be searched, and why"
    )


class LmsReadInput(BaseModel):
    course_id: Id = Field(description="Course id (linked to the LMS)")
    ref: RefStr | None = Field(
        default=None,
        description="A ref exactly as an lms tool returned it (`page:…`, `assignment:…`, "
        "`file:…`…), or from a `lms:<ref>` link in a text",
    )
    url: str | None = Field(
        default=None, max_length=2000, description="Or the item's address on the LMS"
    )
    offset: int = Field(default=0, ge=0, description="Where to go on in a long text: `next_offset`")
    refresh: bool = Field(default=False, description=_REFRESH)

    @model_validator(mode="after")
    def _one(self) -> Self:
        if (self.ref is None) == (self.url is None):
            raise ValueError("give either ref or url")
        return self


class LmsContentDetail(BaseModel):
    ref: str
    kind: ContentKind
    title: str
    url: str | None = Field(default=None, description="Opens it on the LMS")
    date: datetime | None = Field(default=None, description="Posted or last changed")
    due_at: datetime | None = None
    points: float | None = Field(default=None, description="Points possible")
    locked: bool = False
    lock_explanation: str | None = None
    text: str = Field(
        description="Markdown. A link `lms:<ref>` opens with lms.content.read; other links are "
        "ordinary addresses"
    )
    next_offset: int | None = Field(
        default=None, description="The text goes on: call again with this offset"
    )
    note: str | None = None


class LmsActivityInput(BaseModel):
    course_id: Id | None = Field(default=None, description="One course (linked to the LMS)")
    term_id: Id | None = Field(default=None, description="Or every linked course of a term")
    since: datetime | None = Field(default=None, description="Default: 7 days ago")
    refresh: bool = Field(default=False, description=_REFRESH)

    @model_validator(mode="after")
    def _one(self) -> Self:
        if (self.course_id is None) == (self.term_id is None):
            raise ValueError("give either course_id or term_id")
        return self


ActivityKind = Literal["announcement", "grade", "assignment", "change"]


class LmsActivityItem(BaseModel):
    course_id: str
    course: str = Field(description="The course's code or title")
    kind: ActivityKind = Field(
        description="announcement; grade (newly graded); assignment (new or changed, not "
        "imported); change (an imported assignment changed on the LMS: lms.change.import)"
    )
    ref: str | None = None
    title: str
    at: datetime | None = None
    summary: str | None = None


class LmsActivityList(BaseModel):
    since: datetime
    items: list[LmsActivityItem] = Field(description="Newest first")
    skipped: list[LmsSkipped] = Field(default_factory=list)
    truncated: bool = False
