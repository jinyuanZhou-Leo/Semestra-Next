from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field

Id = Annotated[str, Field(min_length=1, max_length=64)]
ItemKind = Literal["file", "link"]
DocStatus = Literal["none", "pending", "processing", "ready", "failed", "unsupported"]
SourceKind = Literal["upload", "lms", "agent"]
SortKey = Literal["name", "size", "updated", "created", "type"]
SearchMode = Literal["hybrid", "keyword", "semantic"]

MAX_FOLDER_DEPTH = 3
MAX_READ_PAGES = 30
# Agent/MCP reads stop before their JSON (pages and citations) grows past this many characters,
# below the assistant's 12 000-character result pages (`agent/tools.py` RESULT_LIMIT).
READ_RESULT_BUDGET = 9_000
MAX_PAGES = 500


class FolderOut(BaseModel):
    id: str
    course_id: str
    parent_id: str | None
    name: str
    position: int
    item_count: int = Field(description="Files and links directly inside the folder")
    created_at: datetime
    updated_at: datetime


class ItemOut(BaseModel):
    id: str
    course_id: str
    folder_id: str | None
    kind: ItemKind
    display_name: str
    original_name: str | None
    mime_type: str | None
    size_bytes: int
    sha256: str | None
    url: str | None
    pinned: bool
    source_kind: SourceKind | None
    source_ref: str | None
    doc_status: DocStatus
    doc_error_code: str | None
    # From the active document.
    page_count: int | None
    ocr_skipped_pages: int
    # The unfinished processing job, so the UI can show its progress.
    job_id: str | None
    created_at: datetime
    updated_at: datetime


# --- list -----------------------------------------------------------------------------------


class FilesItemListInput(BaseModel):
    course_id: Id = Field(description="Course id")
    folder_id: Id | None = Field(
        default=None, description="Only items directly in this folder; omit for the course root"
    )
    recursive: bool = Field(
        default=False, description="List the items of every folder of the course, not just one"
    )
    search: Annotated[str, Field(max_length=200)] | None = Field(
        default=None,
        description="Keep items whose name contains this text (case-insensitive). To search "
        "what the files say, use files.document.search instead.",
    )
    sort: SortKey = Field(default="name", description="Sort key")
    descending: bool = Field(default=False, description="Reverse the sort order")
    fields: list[str] | None = Field(
        default=None,
        description="Agent/MCP only: return just these fields of each item (and its id)",
    )
    cursor: str | None = Field(default=None, description="`next_cursor` of the previous page")
    limit: Annotated[int, Field(ge=1, le=500)] = Field(default=200, description="Page size")


class FilesItemList(BaseModel):
    folders: list[FolderOut] = Field(description="Every folder of the course")
    items: list[ItemOut]
    next_cursor: str | None


class ItemRef(BaseModel):
    item_id: Id = Field(description="File or link id")


class ItemUpdateInput(BaseModel):
    item_id: Id = Field(description="File or link id")
    display_name: Annotated[str, Field(min_length=1, max_length=255)] | None = Field(
        default=None, description="New name"
    )
    folder_id: Id | None = Field(
        default=None, description="Move into this folder; null moves it to the course root"
    )
    pinned: bool | None = Field(default=None, description="Pin it to the quick-open cards")


class Deleted(BaseModel):
    deleted: bool = True


class LinkCreateInput(BaseModel):
    course_id: Id = Field(description="Course id")
    url: Annotated[str, Field(min_length=1, max_length=2000)] = Field(description="http(s) address")
    display_name: Annotated[str, Field(min_length=1, max_length=255)] | None = Field(
        default=None, description="Name to show; defaults to the address' host"
    )
    folder_id: Id | None = Field(default=None, description="Folder to put it in")


class FolderCreateInput(BaseModel):
    course_id: Id = Field(description="Course id")
    name: Annotated[str, Field(min_length=1, max_length=100)] = Field(description="Folder name")
    parent_id: Id | None = Field(default=None, description="Parent folder; null = course root")


class FolderUpdateInput(BaseModel):
    folder_id: Id = Field(description="Folder id")
    name: Annotated[str, Field(min_length=1, max_length=100)] | None = Field(
        default=None, description="New name"
    )
    parent_id: Id | None = Field(
        default=None, description="Move under this folder; null moves it to the course root"
    )
    position: int | None = Field(default=None, ge=0, description="Order among its siblings")


class FolderDeleteInput(BaseModel):
    folder_id: Id = Field(description="Folder id")
    recursive: bool = Field(
        default=False, description="Also delete everything inside; required for a non-empty folder"
    )


class FolderRef(BaseModel):
    folder: FolderOut


class UploadResult(BaseModel):
    items: list[ItemOut]


# --- documents ------------------------------------------------------------------------------


class DocumentReadInput(BaseModel):
    item_id: Id = Field(description="File id")
    page_from: Annotated[int, Field(ge=1)] = Field(default=1, description="First page (1-based)")
    page_to: Annotated[int, Field(ge=1)] | None = Field(
        default=None,
        description=f"Last page; at most {MAX_READ_PAGES} pages, and for the assistant about "
        f"{READ_RESULT_BUDGET} characters, are returned per call",
    )


class Citation(BaseModel):
    """What the assistant's `[[cite:<id>]]` markers point at (M12 §6.1)."""

    id: str = Field(description="`<item_id>:p<page_from>-<page_to>`")
    title: str = Field(description="File name")
    item_id: str
    page_from: int
    page_to: int
    snippet: str = Field(description="The quoted words, plain text")


class DocumentPage(BaseModel):
    page_no: int
    markdown: str
    ocr_used: bool
    citation_id: str = Field(description="`<item_id>:p<page_no>-<page_no>`")


class DocumentRead(BaseModel):
    item_id: str
    display_name: str
    page_count: int
    pages: list[DocumentPage]
    next_page: int | None = Field(description="Call again from this page for the rest")
    citations: list[Citation] = Field(description="One per page; cite a page by its citation_id")


class OutlineEntry(BaseModel):
    level: int
    title: str
    page: int


class DocumentOutline(BaseModel):
    item_id: str
    display_name: str
    page_count: int
    entries: list[OutlineEntry]


# --- search ---------------------------------------------------------------------------------


class SearchInput(BaseModel):
    program_id: Id = Field(description="Program id; the search never leaves this Program")
    query: Annotated[str, Field(min_length=1, max_length=500)] = Field(
        description="What to look for: words from the document or a question"
    )
    term_id: Id | None = Field(default=None, description="Only the courses of this term")
    course_ids: list[Id] | None = Field(default=None, description="Only these courses")
    item_ids: list[Id] | None = Field(default=None, description="Only these files")
    top_k: Annotated[int, Field(ge=1, le=20)] = Field(default=8, description="Results to return")
    mode: SearchMode = Field(
        default="hybrid",
        description="hybrid = keywords and meaning together; keyword; semantic (needs an "
        "embedding model, else falls back to keyword)",
    )


class SearchHit(BaseModel):
    item_id: str
    display_name: str
    course_id: str
    page_from: int
    page_to: int
    heading_path: list[str]
    snippet: str = Field(description="Matching text; matches are wrapped in <mark></mark>")
    score: float
    citation_id: str = Field(description="`<item_id>:p<page_from>-<page_to>`")


class PendingItem(BaseModel):
    item_id: str
    display_name: str
    course_id: str


class UnreadableItem(BaseModel):
    item_id: str
    display_name: str
    course_id: str
    doc_status: Literal["failed", "unsupported"]
    doc_error_code: str | None = Field(description="Why the text could not be read")


class SearchResult(BaseModel):
    results: list[SearchHit]
    pending_items: list[PendingItem] = Field(
        description="Files in scope that are still being processed and are not searchable yet"
    )
    unreadable_items: list[UnreadableItem] = Field(
        description="Files in scope whose text could not be read; search never covers them"
    )
    mode_used: SearchMode
    citations: list[Citation] = Field(description="One per result, by its citation_id")


# --- misc -----------------------------------------------------------------------------------


class PinnedInput(BaseModel):
    program_id: Id = Field(description="Program id")


class PinnedFiles(BaseModel):
    items: list[ItemOut]


class FilesUsageGet(BaseModel):
    used_bytes: int = Field(description="All the user's stored files, every module")
    files_bytes: int = Field(description="Of which course files")
    quota_bytes: int = Field(description="0 means unlimited")
    max_upload_bytes: int
