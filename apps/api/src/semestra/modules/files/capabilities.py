"""Course file capabilities (M07 §5, §7)."""

from semestra.core.agent_output import CHANGED
from semestra.core.capability import Http, NoInput, capability
from semestra.core.context import Ctx
from semestra.core.errors import agent_hints
from semestra.core.events import events
from semestra.core.jobs import JobOut
from semestra.core.labels import owned_row
from semestra.modules.files import (
    documents,
    entries,
    folders,
    items,
    listing,
    organize,
    processing,
    quota,
    search,
    service,
    sources,
)
from semestra.modules.files.models import FilesFolder, FilesItem
from semestra.modules.files.schemas import (
    Deleted,
    DocumentOutline,
    DocumentRead,
    DocumentReadInput,
    EntriesDeleteInput,
    EntriesMoved,
    EntriesMoveInput,
    FileMatches,
    FileSearchInput,
    FilesItemList,
    FilesItemListInput,
    FilesUsageBreakdown,
    FilesUsageGet,
    FolderCreateInput,
    FolderDeleteInput,
    FolderOut,
    FolderUpdateInput,
    ItemOut,
    ItemRef,
    ItemUpdateInput,
    LinkCreateInput,
    OrganizeApplied,
    OrganizeApplyInput,
    OrganizeGetInput,
    OrganizeInput,
    OrganizeState,
    PendingOrganizeList,
    PinnedFiles,
    PinnedInput,
    ProgramInput,
    SearchInput,
    SearchResult,
)

TAGS = ("files",)

# What agents get back (M00 §3.6): no hashes, storage names, import refs or timestamps.
_FILE_FIELDS = (
    "id", "course_id", "folder_id", "kind", "display_name", "mime_type", "size_bytes", "url",
    "pinned", "doc_status", "doc_error_code", "page_count", "ocr_skipped_pages", "source_name",
    "follows_source", "stored", "unseen",
)  # fmt: skip


agent_hints(
    {
        "files.folder_depth": "Folders nest at most `max` deep; put it higher up.",
        "files.folder_name_taken": "That folder already has a folder with this name (any case). "
        "Use the existing one or pick another name.",
        "files.folder_not_empty": "The folder has files or subfolders. Ask the user, then pass "
        "recursive=true to delete them all.",
        "files.not_indexed": "Indexing was off when this file was added, so it has no text to "
        "read or search. Tell the user they can index it from the file's menu.",
        "files.source_unreachable": "The LMS cannot give the file now (the course may be closed "
        "there), so its saved copy is the only one left and stays. Tell the user.",
        "files.not_ready": "The file is still being processed (or failed, see doc_status). Try "
        "again later or tell the user.",
    }
)


@capability(
    name="files.item.list",
    summary="List the files, links and folders of a course.",
    description="""Use to see what a course has: its files and saved links in one folder (or every
folder with recursive=true), with their processing status (doc_status "none" means the file is
stored but not indexed because automatic indexing is off; the user can index it from the file
list). Course materials the LMS sync brought in have `source_name` and follow the LMS
(`follows_source`); ask for `unseen` (new, not opened yet), `stored` (saved in Semestra) or
`modified_at` with `fields` when they matter. Do not use to look for what the files say; use
files.document.search for that.""",
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
    return await listing.list_files(ctx, inp)


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
    record=("item_id", owned_row(FilesItem)),
    summary="Rename, move or pin a file or link.",
    description="""Use when the user wants to rename a file, put it in another folder of the same
course (folder_id null = course root), or pin it for quick access. Only send the fields to
change.""",
    effect="write",
    http=Http("PATCH", "/files/{item_id}"),
    check=items.check_item_update,
    tags=TAGS,
    agent_output_fields=("id", "display_name", CHANGED),
)
async def item_update(ctx: Ctx, inp: ItemUpdateInput) -> ItemOut:
    return await items.update_item(ctx, inp)


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
    return await items.create_link(ctx, inp.course_id, inp.url, inp.display_name, inp.folder_id)


@capability(
    name="files.folder.create",
    summary="Create a folder in a course's files.",
    description="""Use to organise a course's files. Folders can be nested up to three levels. Move
a file into the new folder with files.item.update (`folder_id`).""",
    effect="write",
    http=Http("POST", "/courses/{course_id}/folders"),
    tags=TAGS,
    agent_output_fields=("id", "name", "parent_id"),
)
async def folder_create(ctx: Ctx, inp: FolderCreateInput) -> FolderOut:
    return await folders.create_folder(ctx, inp.course_id, inp.name, inp.parent_id)


@capability(
    name="files.folder.update",
    record=("folder_id", owned_row(FilesFolder)),
    summary="Rename or move a folder.",
    description="""Rename a folder or move it under another folder (parent_id null = course root).
Folders are listed by name. Only send the fields to change.""",
    effect="write",
    http=Http("PATCH", "/folders/{folder_id}"),
    tags=TAGS,
    agent_output_fields=("id", "name", "parent_id"),
)
async def folder_update(ctx: Ctx, inp: FolderUpdateInput) -> FolderOut:
    return await folders.update_folder(
        ctx, inp.folder_id, set(inp.model_fields_set), inp.name, inp.parent_id
    )


@capability(
    name="files.folder.delete",
    summary="Delete a folder, optionally with everything in it.",
    description="""Use only when the user clearly asks. A folder that is not empty is refused
unless recursive=true, which permanently deletes all its files, links and subfolders.""",
    effect="destructive",
    http=Http("DELETE", "/folders/{folder_id}"),
    preview=folders.preview_folder_delete,
    check=folders.check_folder_delete,
    tags=TAGS,
)
async def folder_delete(ctx: Ctx, inp: FolderDeleteInput) -> Deleted:
    await folders.delete_folder(ctx, inp.folder_id, inp.recursive)
    return Deleted()


@capability(
    name="files.entry.move_many",
    summary="Move several files, links and folders of a course into one folder.",
    description="""Use when the user wants several things of one course in another folder of the
same course (to_folder_id null = course root). Folders move with everything inside them. All of
them move or, if one cannot (a folder name already taken there, folders nested too deep), none
do.""",
    effect="write",
    http=Http("POST", "/courses/{course_id}/files:move"),
    tags=TAGS,
)
async def entries_move(ctx: Ctx, inp: EntriesMoveInput) -> EntriesMoved:
    moved = await entries.move_entries(
        ctx, inp.course_id, inp.item_ids, inp.folder_ids, inp.to_folder_id
    )
    return EntriesMoved(moved=moved)


@capability(
    name="files.entry.delete_many",
    summary="Delete several files, links and folders of a course permanently.",
    description="""Use only when the user clearly asks to delete these. Folders go with
everything inside them; nothing can be restored. All of them are deleted, or none if one is
not found.""",
    effect="destructive",
    http=Http("POST", "/courses/{course_id}/files:delete"),
    preview=entries.preview_entries_delete,
    tags=TAGS,
)
async def entries_delete(ctx: Ctx, inp: EntriesDeleteInput) -> Deleted:
    await entries.delete_entries(ctx, inp.course_id, inp.item_ids, inp.folder_ids)
    return Deleted()


@capability(
    name="files.item.reprocess",
    summary="Read a file's text again.",
    description="""Starts the document pipeline again for a file, for example after a failure
(doc_status failed), when it was not indexed, or after an AI model for reading scanned pages was
set up. It runs in the background; doc_status is pending until it is done.""",
    effect="write",
    http=Http("POST", "/files/{item_id}:reprocess"),
    tags=TAGS,
    agent_output_fields=("id", "display_name", "doc_status"),
)
async def reprocess(ctx: Ctx, inp: ItemRef) -> ItemOut:
    return await items.reprocess(ctx, inp.item_id)


@capability(
    name="files.item.keep_copy",
    summary="Save a course material from the LMS in Semestra.",
    description="""For a file that follows the LMS (follows_source): stores it here (in the
background when it is read from the LMS), whatever the course's setting, so it still opens after
it is deleted there or the course closes. It still follows the LMS (updated, and kept as the
user's own file if deleted there). Only when the user asks to keep it; reading never needs it. It
takes storage quota; one too large or beyond the quota left is refused.""",
    effect="write",
    http=Http("POST", "/files/{item_id}:keep-copy"),
    tags=TAGS,
    agent_output_fields=("id", "display_name", "stored"),
)
async def keep_copy(ctx: Ctx, inp: ItemRef) -> ItemOut:
    row = await service.get_item(ctx, inp.item_id)
    await sources.keep_copy(ctx, row)
    return await service.item_out(ctx, row)


@capability(
    name="files.item.drop_copy",
    summary="Stop saving a course material from the LMS in Semestra.",
    description="""Undoes files.item.keep_copy: the file is read from the LMS when opened again,
whatever the course's setting, and its storage is freed. Refused while the LMS cannot give the
file (its saved copy is then the only one left).""",
    effect="write",
    http=Http("POST", "/files/{item_id}:drop-copy"),
    tags=TAGS,
    agent_output_fields=("id", "display_name", "stored"),
)
async def drop_copy(ctx: Ctx, inp: ItemRef) -> ItemOut:
    row = await service.get_item(ctx, inp.item_id)
    await sources.drop_copy(ctx, row)
    return await service.item_out(ctx, row)


@capability(
    name="files.item.mark_seen",
    summary="Mark a file opened.",
    description="A file its source brought in is new until opened or previewed.",
    effect="write",
    http=Http("POST", "/files/{item_id}:seen"),
    expose=("http",),
    tags=TAGS,
)
async def mark_seen(ctx: Ctx, inp: ItemRef) -> ItemOut:
    row = await service.get_item(ctx, inp.item_id)
    if row.unseen:
        row.unseen = False
        await ctx.db.flush()
        await events.publish(
            ctx, "files.item.updated", {"item_id": row.id, "course_id": row.course_id}
        )
    return await service.item_out(ctx, row)


@capability(
    name="files.document.search",
    untrusted=True,
    summary="Search what the course files say.",
    description="""Use to answer questions about course content (syllabus rules, dates, lecture
material): finds the passages of the user's files that match, with page numbers. Narrow it with
course_ids or term_id. Quote results with their citation_id. If pending_items is not empty, some
files are still being processed; if unindexed_items is not empty, those files are not indexed yet
(tell the user they can index them with "Index" in the file list); if unreadable_items is not
empty, those files could not be read at all. In all these cases tell the user the answer may be
incomplete. Do not use to find a file by its name; use files.item.list.""",
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
    return await quota.usage(ctx)


@capability(
    name="files.usage.breakdown",
    summary="Break course file storage down by course and by file type.",
    description="""Bytes and file counts per course and per type (PDF, image, Office, text,
other), largest first. Shown on the account's data settings.""",
    effect="read",
    http=Http("GET", "/files-usage/breakdown"),
    expose=("http",),
    tags=TAGS,
)
async def usage_breakdown(ctx: Ctx, inp: NoInput) -> FilesUsageBreakdown:
    del inp
    return await quota.usage_breakdown(ctx)


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
    return PinnedFiles(items=await listing.pinned(ctx, inp.program_id))


@capability(
    name="files.item.search",
    summary="Find the files of a Program by name.",
    description="""Files (not links or folders) of the Program's courses whose name contains the
query, most recently changed first, with just what a picker needs. Used by the assistant's `@`
menu.""",
    effect="read",
    http=Http("GET", "/programs/{program_id}/file-names"),
    expose=("http",),
    tags=TAGS,
)
async def search_names(ctx: Ctx, inp: FileSearchInput) -> FileMatches:
    return FileMatches(items=await listing.search_names(ctx, inp))


@capability(
    name="files.organization.start",
    summary="Work out where a course's loose files belong.",
    description="""Starts a job that finds where files would go and keeps that as the course's
plan (replacing one not yet applied): the user's own files at the top level go into the course's
folder that fits them (or a new folder for a group of them), and LMS materials the user has not
moved go back to their folder on the LMS when they were filed elsewhere before. Nothing is
moved: the plan waits for the user's review, in the
course's files or with you (`files.organization.get`, then `files.organization.apply`). Call
files.organization.get first: when a plan already waits for review, go through that one instead
of starting again, unless the user asks to.""",
    effect="write",
    http=Http("POST", "/courses/{course_id}/files:organize"),
    preview=organize.preview_start,
    tags=TAGS,
)
async def organization_start(ctx: Ctx, inp: OrganizeInput) -> JobOut:
    return await organize.start(ctx, inp.course_id)


@capability(
    name="files.organization.get",
    untrusted=True,
    summary="Where a course's organizing stands, with its plan once worked out.",
    description="""While the job reads (`job` set, no `plan`), pass wait_seconds to wait for the
plan. The plan lists each file with the folder it would go in, the files the user has moved or
deleted since left out; `left` files stay where they are. Show the user the plan before applying
it.""",
    effect="read",
    http=Http("GET", "/courses/{course_id}/files:organize"),
    tags=TAGS,
)
async def organization_get(ctx: Ctx, inp: OrganizeGetInput) -> OrganizeState:
    return await organize.state(ctx, inp.course_id, inp.wait_seconds)


@capability(
    name="files.organization.list",
    summary="The organizing under way in a Program's courses.",
    description="""Each course whose organizing is reading, failed (not yet seen), or waits for
review, with how many files its plan would still move.""",
    effect="read",
    http=Http("GET", "/programs/{program_id}/file-organizations"),
    expose=("http",),
    tags=TAGS,
)
async def organization_list(ctx: Ctx, inp: ProgramInput) -> PendingOrganizeList:
    return await organize.pending(ctx, inp.program_id)


@capability(
    name="files.organization.apply",
    summary="Move a course's files into their folders, as its plan says.",
    description="""Applies the course's plan to the files the user kept (`item_ids`, from
files.organization.get): each goes in its folder, made when the course has none. Files
moved or deleted since the plan stay as they are. The plan is done with afterwards.""",
    effect="write",
    http=Http("POST", "/courses/{course_id}/files:organize-apply"),
    preview=organize.preview_apply,
    tags=TAGS,
)
async def organization_apply(ctx: Ctx, inp: OrganizeApplyInput) -> OrganizeApplied:
    return await organize.apply(ctx, inp.course_id, inp.item_ids)


@capability(
    name="files.organization.discard",
    summary="Discard a course's organizing plan without moving anything.",
    description="The plan is done with; the files stay where they are.",
    effect="write",
    http=Http("DELETE", "/courses/{course_id}/files:organize"),
    expose=("http",),
    tags=TAGS,
)
async def organization_discard(ctx: Ctx, inp: OrganizeInput) -> Deleted:
    await organize.discard(ctx, inp.course_id)
    return Deleted()


@capability(
    name="files.processing.list",
    summary="List the files being read in the background.",
    description="""Every file whose text is being read or waits to be (uploads and synced course
materials), with its job, plus the ones that ended in the last days.""",
    effect="read",
    http=Http("GET", "/me/files/processing"),
    expose=("http",),
    tags=TAGS,
)
async def processing_list(ctx: Ctx, inp: NoInput) -> processing.ProcessingList:
    return await processing.list_processing(ctx)


@capability(
    name="files.processing.cancel_all",
    summary="Stop reading every file that is being read or waits to be.",
    description="""Each file is left as not read and can be read again later.""",
    effect="write",
    http=Http("POST", "/me/files/processing:cancel"),
    expose=("http",),
    tags=TAGS,
)
async def processing_cancel_all(ctx: Ctx, inp: NoInput) -> processing.CancelledAll:
    return await processing.cancel_all(ctx)


@capability(
    name="files.processing.retry",
    summary="Read the given files again.",
    description="""For the files that failed or were stopped; each is read again as with
files.item.reprocess.""",
    effect="write",
    http=Http("POST", "/me/files/processing:retry"),
    expose=("http",),
    tags=TAGS,
)
async def processing_retry(ctx: Ctx, inp: processing.RetryInput) -> processing.Retried:
    return await processing.retry(ctx, inp)
