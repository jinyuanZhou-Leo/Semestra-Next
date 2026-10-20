"""Course file capabilities (M07 §5, §7)."""

from semestra.core.agent_output import CHANGED
from semestra.core.capability import Http, NoInput, capability
from semestra.core.context import Ctx
from semestra.modules.files import documents, search, service
from semestra.modules.files.schemas import (
    Deleted,
    DocumentOutline,
    DocumentRead,
    DocumentReadInput,
    FilesItemList,
    FilesItemListInput,
    FilesUsageGet,
    FolderCreateInput,
    FolderDeleteInput,
    FolderOut,
    FolderUpdateInput,
    ItemOut,
    ItemRef,
    ItemUpdateInput,
    LinkCreateInput,
    PinnedFiles,
    PinnedInput,
    SearchInput,
    SearchResult,
)

TAGS = ("files",)

# What agents get back (M00 §3.6): no hashes, storage names, import refs or timestamps.
_FILE_FIELDS = (
    "id", "course_id", "folder_id", "kind", "display_name", "mime_type", "size_bytes", "url",
    "pinned", "doc_status", "doc_error_code", "page_count", "ocr_skipped_pages",
)  # fmt: skip


@capability(
    name="files.item.list",
    summary="List the files, links and folders of a course.",
    description="""Use to see what a course has: its files and saved links in one folder (or every
folder with recursive=true), with their processing status. Do not use to look for what the files
say; use files.document.search for that.""",
    effect="read",
    http=Http("GET", "/courses/{course_id}/files"),
    tags=TAGS,
    agent_default_fields=(
        "display_name",
        "kind",
        "folder_id",
        "doc_status",
        "page_count",
        "pinned",
    ),
    agent_output_fields=(
        "folders.id",
        "folders.parent_id",
        "folders.name",
        "folders.item_count",
        "items",
        "next_cursor",
    ),
)
async def files_list(ctx: Ctx, inp: FilesItemListInput) -> FilesItemList:
    return await service.list_files(ctx, inp)


@capability(
    name="files.item.get",
    summary="Get one file or link.",
    description="""Use to check a file's name, type, size and whether its text is ready to read
(doc_status = ready). Use files.document.read to read the text.""",
    effect="read",
    http=Http("GET", "/files/{item_id}"),
    tags=TAGS,
    agent_output_fields=_FILE_FIELDS,
)
async def item_get(ctx: Ctx, inp: ItemRef) -> ItemOut:
    return await service.item_out(ctx, await service.get_item(ctx, inp.item_id))


@capability(
    name="files.item.update",
    summary="Rename, move or pin a file or link.",
    description="""Use when the user wants to rename a file, put it in another folder of the same
course (folder_id null = course root), or pin it for quick access. Only send the fields to
change.""",
    effect="write",
    http=Http("PATCH", "/files/{item_id}"),
    tags=TAGS,
    agent_output_fields=("id", "display_name", CHANGED),
)
async def item_update(ctx: Ctx, inp: ItemUpdateInput) -> ItemOut:
    return await service.update_item(ctx, inp)


@capability(
    name="files.item.delete",
    summary="Delete a file or link permanently.",
    description="""Use only when the user clearly asks to delete a file or link. The stored file
and everything derived from it (text, search index) is removed and cannot be restored.""",
    effect="destructive",
    http=Http("DELETE", "/files/{item_id}"),
    preview=service.preview_item_delete,
    tags=TAGS,
)
async def item_delete(ctx: Ctx, inp: ItemRef) -> Deleted:
    await service.delete_item(ctx, inp.item_id)
    return Deleted()


@capability(
    name="files.link.create",
    summary="Save a web link in a course's files.",
    description="""Use when the user wants to keep a web page (an http or https address) next to
the course files. Do not use to save a file; uploads are done by the user in the app.""",
    effect="write",
    http=Http("POST", "/courses/{course_id}/file-links"),
    tags=TAGS,
    agent_output_fields=("id", "display_name", "url"),
)
async def link_create(ctx: Ctx, inp: LinkCreateInput) -> ItemOut:
    return await service.create_link(ctx, inp.course_id, inp.url, inp.display_name, inp.folder_id)


@capability(
    name="files.folder.create",
    summary="Create a folder in a course's files.",
    description="""Use to organise a course's files. Folders can be nested up to three levels.""",
    effect="write",
    http=Http("POST", "/courses/{course_id}/folders"),
    tags=TAGS,
    agent_output_fields=("id", "name", "parent_id"),
)
async def folder_create(ctx: Ctx, inp: FolderCreateInput) -> FolderOut:
    return await service.create_folder(ctx, inp.course_id, inp.name, inp.parent_id)


@capability(
    name="files.folder.update",
    summary="Rename or move a folder, or change its order.",
    description="""Rename a folder, move it under another folder (parent_id null = course root) or
set its position among its siblings. Only send the fields to change.""",
    effect="write",
    http=Http("PATCH", "/folders/{folder_id}"),
    expose=("http",),
    tags=TAGS,
)
async def folder_update(ctx: Ctx, inp: FolderUpdateInput) -> FolderOut:
    return await service.update_folder(
        ctx, inp.folder_id, set(inp.model_fields_set), inp.name, inp.parent_id, inp.position
    )


@capability(
    name="files.folder.delete",
    summary="Delete a folder, optionally with everything in it.",
    description="""Use only when the user clearly asks. A folder that is not empty is refused
unless recursive=true, which permanently deletes all its files, links and subfolders.""",
    effect="destructive",
    http=Http("DELETE", "/folders/{folder_id}"),
    preview=service.preview_folder_delete,
    tags=TAGS,
)
async def folder_delete(ctx: Ctx, inp: FolderDeleteInput) -> Deleted:
    await service.delete_folder(ctx, inp.folder_id, inp.recursive)
    return Deleted()


@capability(
    name="files.item.reprocess",
    summary="Read a file's text again.",
    description="""Starts the document pipeline again for a file, for example after a failure or
after an AI model for reading scanned pages was set up.""",
    effect="write",
    http=Http("POST", "/files/{item_id}:reprocess"),
    expose=("http",),
    tags=TAGS,
)
async def reprocess(ctx: Ctx, inp: ItemRef) -> ItemOut:
    return await service.reprocess(ctx, inp.item_id)


@capability(
    name="files.document.search",
    agent_core=True,
    untrusted=True,
    summary="Search what the course files say.",
    description="""Use to answer questions about course content (syllabus rules, dates, lecture
material): finds the passages of the user's files that match, with page numbers. Narrow it with
course_ids or term_id. Quote results with their citation_id. If pending_items is not empty, some
files are still being processed; if unreadable_items is not empty, those files could not be read
at all. In both cases tell the user the answer may be incomplete. Do not use to find a file by its
name; use files.item.list.""",
    effect="read",
    http=Http("POST", "/programs/{program_id}/files:search"),
    tags=TAGS,
)
async def files_search(ctx: Ctx, inp: SearchInput) -> SearchResult:
    return await search.search(ctx, inp)


@capability(
    name="files.document.read",
    untrusted=True,
    summary="Read the text of a processed file, page by page.",
    description="""Returns the markdown of the pages from page_from (a few pages per call, each with
its citation_id). When next_page is set, call again from there to continue. Use it to summarise or
extract from a whole document; to find something specific use files.document.search first.""",
    effect="read",
    http=Http("GET", "/files/{item_id}/document"),
    tags=TAGS,
)
async def document_read(ctx: Ctx, inp: DocumentReadInput) -> DocumentRead:
    return await documents.read_document(ctx, inp.item_id, inp.page_from, inp.page_to)


@capability(
    name="files.document.outline",
    untrusted=True,
    summary="Get the headings of a processed file with their page numbers.",
    description="""Use to see the structure of a long document before reading parts of it.""",
    effect="read",
    http=Http("GET", "/files/{item_id}/outline"),
    tags=TAGS,
)
async def document_outline(ctx: Ctx, inp: ItemRef) -> DocumentOutline:
    return await documents.outline(ctx, inp.item_id)


@capability(
    name="files.usage.get",
    summary="Get how much file storage is used.",
    description="""Used and available storage, and the largest file that can be uploaded.""",
    effect="read",
    http=Http("GET", "/files-usage"),
    expose=("http",),
    tags=TAGS,
)
async def usage(ctx: Ctx, inp: NoInput) -> FilesUsageGet:
    del inp
    return await service.usage(ctx)


@capability(
    name="files.item.list_pinned",
    summary="List the pinned files of a Program.",
    description="""Files and links the user pinned for quick access, across the Program's
courses.""",
    effect="read",
    http=Http("GET", "/programs/{program_id}/pinned-files"),
    expose=("http",),
    tags=TAGS,
)
async def pinned(ctx: Ctx, inp: PinnedInput) -> PinnedFiles:
    return PinnedFiles(items=await service.pinned(ctx, inp.program_id))
