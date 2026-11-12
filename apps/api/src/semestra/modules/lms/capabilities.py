"""LMS capabilities (M09 §5). Connection management is HTTP only: credentials never pass
through agents or MCP clients."""

from semestra.core.capability import Http, NoInput, capability
from semestra.core.context import Ctx
from semestra.modules.lms import (
    imports,
    previews,
    reads,
    service,
    sync,
    sync_assignments,
    sync_status,
)
from semestra.modules.lms.schemas.dto import (
    FileMeta,
    FolderListing,
    PageDetail,
    RichText,
    SubmissionDetail,
)
from semestra.modules.lms.schemas.io import (
    AnnouncementList,
    AnnouncementRead,
    AnnouncementReadInput,
    AnnouncementsInput,
    AssessmentRef,
    AssignmentBinding,
    AssignmentBindInput,
    AssignmentImportInput,
    AssignmentList,
    AssignmentsImportInput,
    AssignmentsInput,
    BindingSetInput,
    Connection,
    ConnectionCheck,
    ConnectionCreateInput,
    ConnectionDeleted,
    ConnectionDeleteInput,
    ConnectionList,
    ConnectionUpdateInput,
    ConnectionValidateInput,
    CourseLinkList,
    CourseLinkState,
    CourseOverview,
    CourseReadInput,
    CourseRef,
    CoursesImportInput,
    ExternalCourseList,
    ExternalCourseListInput,
    FileInput,
    FileList,
    FilePreview,
    FileSaveInput,
    FileSearchInput,
    FolderInput,
    GradeList,
    ImportStarted,
    LinkSetInput,
    LinkUpdateInput,
    ModuleItemList,
    ModuleItemsInput,
    ModuleList,
    PageGetInput,
    PageList,
    ProgramBinding,
    ProgramRef,
    ProviderList,
    QuizList,
    QuizzesInput,
    SavedFile,
    SignInStart,
    SignInStartInput,
    SubmissionInput,
    TermAnnouncementList,
    TermAnnouncementsInput,
)
from semestra.modules.lms.schemas.sync import (
    SyncChangeRef,
    SyncDismissInput,
    SyncQueued,
    SyncRequestInput,
    SyncResolveInput,
    SyncStatus,
)

HTTP_ONLY = ("http",)
TAGS = ("lms",)
# The assistant reads through `agent_tools.py` (outline, search, read, activity); the reads here
# are the Canvas tab's, one per platform endpoint, so they are HTTP only (M09 §8).

# What agents get back (M00 §3.6): no connection config or credential hints, provider debug
# kinds, platform links or timestamps the model has no use for.
_BINDING_FIELDS = (
    "program_id", "connection_id", "link_count", "connection.id", "connection.provider",
    "connection.display_name", "connection.account_name", "connection.status",
    "connection.last_error_code",
)  # fmt: skip
_LINK = (
    "id", "connection_id", "external_course_id", "external_code", "external_name",
    "external_term", "sync_enabled", "synced_at", "sync_errors",
)  # fmt: skip
_LINK_FIELDS = ("course_id", "program_connection_id", *(f"link.{f}" for f in _LINK))

# --- providers and connections --------------------------------------------------------------


@capability(
    name="lms.provider.list",
    summary="LMS platforms the app can connect to, with their features and settings.",
    description="Features the provider lacks are not offered for its connections.",
    effect="read",
    http=Http("GET", "/lms/providers"),
    expose=HTTP_ONLY,
    tags=TAGS,
    agent_output_fields=("items.kind", "items.display_name", "items.features"),
)
async def providers_list(ctx: Ctx, inp: NoInput) -> ProviderList:
    return ProviderList(items=service.providers(ctx.settings))


@capability(
    name="lms.connection.sign_in.start",
    summary="Start connecting an LMS by signing in on the platform's own page.",
    description="""Returns the address to open in the user's browser; the address that page ends
on goes to lms.connection.create (or update) as `sign_in`. Only where the server allows it
(providers with `sign_in`). Not for agents.""",
    effect="read",
    http=Http("POST", "/lms/connections:sign-in"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def connection_sign_in_start(ctx: Ctx, inp: SignInStartInput) -> SignInStart:
    return await service.start_sign_in(ctx, inp)


@capability(
    name="lms.connection.list",
    summary="The user's LMS connections (credentials masked).",
    description="Not for agents.",
    effect="read",
    http=Http("GET", "/lms/connections"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def connection_list(ctx: Ctx, inp: NoInput) -> ConnectionList:
    return ConnectionList(items=await service.list_connections(ctx))


@capability(
    name="lms.connection.create",
    summary="Connect an LMS account; the settings are checked before saving.",
    description="Credentials are stored encrypted and only ever shown masked. Not for agents.",
    effect="write",
    http=Http("POST", "/lms/connections"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def connection_create(ctx: Ctx, inp: ConnectionCreateInput) -> Connection:
    return await service.create_connection(ctx, inp)


@capability(
    name="lms.connection.update",
    summary="Rename an LMS connection or change its address or credentials.",
    description="New settings or credentials are checked before saving. Not for agents.",
    effect="write",
    http=Http("PATCH", "/lms/connections/{id}"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def connection_update(ctx: Ctx, inp: ConnectionUpdateInput) -> Connection:
    return await service.update_connection(ctx, inp)


@capability(
    name="lms.connection.delete",
    summary="Remove an LMS connection.",
    description="""Refused while Programs are bound to it (lms.connection_in_use) unless
`detach_all`, which also unbinds them and unlinks their courses; imported assessments, tasks
and files stay. Not for agents.""",
    effect="destructive",
    http=Http("DELETE", "/lms/connections/{id}"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def connection_delete(ctx: Ctx, inp: ConnectionDeleteInput) -> ConnectionDeleted:
    return await service.delete_connection(ctx, inp.id, inp.detach_all)


@capability(
    name="lms.connection.validate",
    summary="Test LMS settings before saving, or re-check a saved connection.",
    description="A re-check records the connection's status. Not for agents.",
    effect="read",
    http=Http("POST", "/lms/connections:validate"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def connection_validate(ctx: Ctx, inp: ConnectionValidateInput) -> ConnectionCheck:
    return await service.validate(ctx, inp)


# --- Program binding ------------------------------------------------------------------------


@capability(
    name="lms.program.binding.get",
    summary="Which LMS connection a Program uses.",
    description="""Courses of the Program can only be linked through this connection. The user
manages connections in settings.""",
    effect="read",
    http=Http("GET", "/programs/{program_id}/lms-binding"),
    expose=HTTP_ONLY,
    tags=TAGS,
    agent_output_fields=_BINDING_FIELDS,
)
async def binding_get(ctx: Ctx, inp: ProgramRef) -> ProgramBinding:
    return await service.get_binding(ctx, inp.program_id)


@capability(
    name="lms.program.binding.set",
    summary="Bind an LMS connection to a Program.",
    description="""Refused while courses of the Program are linked (lms.program_has_links).
Afterwards link courses with lms.course.link.set.""",
    effect="write",
    http=Http("PUT", "/programs/{program_id}/lms-binding"),
    preview=previews.preview_binding_set,
    expose=HTTP_ONLY,
    tags=TAGS,
    agent_output_fields=_BINDING_FIELDS,
)
async def binding_set(ctx: Ctx, inp: BindingSetInput) -> ProgramBinding:
    return await service.set_binding(ctx, inp)


@capability(
    name="lms.program.binding.clear",
    summary="Unbind a Program's LMS connection.",
    description="""Refused while courses of the Program are linked (lms.program_has_links): unlink
them with lms.course.link.delete first. The connection itself stays.""",
    effect="write",
    http=Http("DELETE", "/programs/{program_id}/lms-binding"),
    preview=previews.preview_binding_clear,
    expose=HTTP_ONLY,
    tags=TAGS,
    agent_output_fields=_BINDING_FIELDS,
)
async def binding_clear(ctx: Ctx, inp: ProgramRef) -> ProgramBinding:
    return await service.clear_binding(ctx, inp.program_id)


# --- external courses and links -------------------------------------------------------------


@capability(
    name="lms.course.list",
    summary="The user's courses on the Program's LMS (e.g. Canvas), marked when already linked.",
    description="""Current-term courses by default; `include_past` for all of them. To link one
to a course here: lms.course.link.set; to create courses from them: lms.course.import.""",
    effect="read",
    http=Http("GET", "/programs/{program_id}/lms/courses"),
    tags=TAGS,
    agent_output_fields=(
        "connection_id",
        "provider",
        "truncated",
        *(
            f"items.{f}"
            for f in (
                "external_id",
                "code",
                "name",
                "term",
                "start_at",
                "end_at",
                "is_current",
                "linked_course_id",
                "linked_course_name",
            )
        ),
    ),
)
async def courses_list(ctx: Ctx, inp: ExternalCourseListInput) -> ExternalCourseList:
    return await service.external_courses(
        ctx, inp.program_id, include_past=inp.include_past, refresh=inp.refresh
    )


@capability(
    name="lms.course.link.get",
    summary="The LMS course a course is linked to, if any.",
    description="""Also says which connection the course's Program is bound to. Check it before the
lms.* read tools: they need a linked course (lms.course_not_linked otherwise). Link a course with
lms.course.link.set.""",
    effect="read",
    http=Http("GET", "/courses/{course_id}/lms-link"),
    expose=HTTP_ONLY,
    tags=TAGS,
    agent_output_fields=_LINK_FIELDS,
)
async def link_get(ctx: Ctx, inp: CourseRef) -> CourseLinkState:
    return await service.link_state(ctx, inp.course_id)


@capability(
    name="lms.course.link.list",
    summary="Every LMS course link in a Program.",
    description="""Which of the Program's courses are linked, and to which LMS course, in one call.
For one course use lms.course.link.get, which also says which connection the Program uses.""",
    effect="read",
    http=Http("GET", "/programs/{program_id}/lms-links"),
    expose=HTTP_ONLY,
    tags=TAGS,
    agent_output_fields=tuple(f"items.{f}" for f in _LINK),
)
async def link_list(ctx: Ctx, inp: ProgramRef) -> CourseLinkList:
    return await service.link_list(ctx, inp.program_id)


@capability(
    name="lms.course.link.set",
    summary="Link a course to its course on the Program's LMS (Canvas or another).",
    description="""Pick the course from lms.course.list. Uses the Program's bound connection
(lms.program_not_configured without one: the user connects one in settings).
An external course can be linked to only one course of the Program
(lms.course_already_linked). If the course is already linked to another external course this fails
with lms.course_link_exists (naming that course) unless replace is true; replacing stops tracking
what was imported through the old link.""",
    effect="write",
    http=Http("PUT", "/courses/{course_id}/lms-link"),
    preview=previews.preview_link_set,
    tags=TAGS,
    agent_output_fields=_LINK_FIELDS,
    check=service.check_link,
)
async def link_set(ctx: Ctx, inp: LinkSetInput) -> CourseLinkState:
    return await service.set_link(ctx, inp)


@capability(
    name="lms.course.link.update",
    summary="Turn LMS sync of a linked course on or off.",
    description="""Off: no calendar overlay and no update checks; reading still works. To remove the
link altogether use lms.course.link.delete.""",
    effect="write",
    http=Http("PATCH", "/courses/{course_id}/lms-link"),
    preview=previews.preview_link_update,
    expose=HTTP_ONLY,
    tags=TAGS,
    agent_output_fields=_LINK_FIELDS,
)
async def link_update(ctx: Ctx, inp: LinkUpdateInput) -> CourseLinkState:
    return await service.update_link(ctx, inp.course_id, inp.sync_enabled)


@capability(
    name="lms.course.link.delete",
    summary="Unlink a course from its LMS course.",
    description="""Imported assessments, tasks and files stay; LMS reads, calendar overlay and
update checks stop for this course. Link it again with lms.course.link.set. To pause syncing but
keep reading, use lms.course.link.update instead.""",
    effect="write",
    http=Http("DELETE", "/courses/{course_id}/lms-link"),
    preview=previews.preview_link_delete,
    expose=HTTP_ONLY,
    tags=TAGS,
    agent_output_fields=_LINK_FIELDS,
)
async def link_delete(ctx: Ctx, inp: CourseRef) -> CourseLinkState:
    return await service.delete_link(ctx, inp.course_id)


# --- reads ----------------------------------------------------------------------------------


@capability(
    name="lms.course.overview",
    summary="A linked course on the LMS: details, navigation and supported features.",
    description="A read the platform does not support fails with lms.feature_unsupported.",
    effect="read",
    http=Http("GET", "/courses/{course_id}/lms"),
    expose=HTTP_ONLY,
    tags=TAGS,
    agent_output_fields=(
        "provider_name",
        "features",
        "default_view",
        "truncated",
        *(f"link.{f}" for f in _LINK),
        "course.code",
        "course.name",
        "course.term",
        "course.start_at",
        "course.end_at",
        "navigation.kind",
        "navigation.label",
        "navigation.hidden",
    ),
)
async def course_overview(ctx: Ctx, inp: CourseReadInput) -> CourseOverview:
    return await reads.overview(ctx, inp.course_id, inp.refresh)


@capability(
    name="lms.course.refresh",
    summary="Forget what the app cached about a linked course, so its next reads ask the LMS.",
    description="""The Canvas tab's "Refresh". Reads with `refresh` do the same for one read.
Not for agents.""",
    effect="write",
    http=Http("POST", "/courses/{course_id}/lms:refresh"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def course_refresh(ctx: Ctx, inp: CourseRef) -> CourseLinkState:
    await reads.refresh_course(ctx, inp.course_id)
    return await service.link_state(ctx, inp.course_id)


@capability(
    name="lms.announcement.list",
    untrusted=True,
    summary="Recent announcements of a linked course on Canvas or another LMS, newest first.",
    description="",
    effect="read",
    http=Http("GET", "/courses/{course_id}/lms/announcements"),
    expose=HTTP_ONLY,
    tags=TAGS,
    agent_default_fields=("title", "author", "posted_at", "unread"),
)
async def announcements_list(ctx: Ctx, inp: AnnouncementsInput) -> AnnouncementList:
    return await reads.announcements(ctx, inp.course_id, inp.since, inp.refresh)


@capability(
    name="lms.term.announcement.list",
    untrusted=True,
    summary="Recent announcements of every LMS-linked course of a term, newest first.",
    description="""One request per connection (the term board's card); each item names its
`course_id`. Not for agents: they read one course with lms.announcement.list.""",
    effect="read",
    http=Http("GET", "/terms/{term_id}/lms/announcements"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def term_announcements_list(ctx: Ctx, inp: TermAnnouncementsInput) -> TermAnnouncementList:
    return await reads.term_announcements(ctx, inp.term_id, inp.refresh)


@capability(
    name="lms.announcement.mark_read",
    summary="Mark an announcement read on the LMS.",
    description="""Only when the user allows Semestra to change things on the platform (account
setting `lms.allow_writes`), otherwise lms.writes_disabled. Not for agents.""",
    effect="write",
    http=Http("POST", "/courses/{course_id}/lms/announcements/{announcement_id}:read"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def announcement_mark_read(ctx: Ctx, inp: AnnouncementReadInput) -> AnnouncementRead:
    await reads.mark_announcement_read(ctx, inp.course_id, inp.announcement_id)
    return AnnouncementRead(announcement_id=inp.announcement_id, unread=False)


@capability(
    name="lms.assignment.list",
    untrusted=True,
    summary="Assignments and graded quizzes of a linked course on the LMS (Canvas), with the "
    "user's scores and the course total, marked when imported.",
    description="""For "what is due", "what is missing" and "what did I get": filter by `status`
or due dates; `include_total` adds the course total. Each has a `ref`: lms.content.read gives
its text, rubric and the teacher's feedback. To add them to the gradebook or tasks use
lms.assignment.import, never the gradebook or task capabilities directly.""",
    effect="read",
    http=Http("GET", "/courses/{course_id}/lms/assignments"),
    tags=TAGS,
    agent_default_fields=(
        "name",
        "due_at",
        "points",
        "group_name",
        "submission",
        "imported_as",
    ),
)
async def assignments_list(ctx: Ctx, inp: AssignmentsInput) -> AssignmentList:
    return await reads.assignments(ctx, inp)


@capability(
    name="lms.submission.get",
    untrusted=True,
    summary="The user's submission of one assignment on the LMS, with the teacher's feedback.",
    description="""Score, attempts, the teacher's comments and the rubric scores (match
`rubric_scores.criterion_id` with the assignment's `rubric` from lms.assignment.list).""",
    effect="read",
    http=Http("GET", "/courses/{course_id}/lms/assignments/{assignment_id}/submission"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def submission_get(ctx: Ctx, inp: SubmissionInput) -> SubmissionDetail:
    return await reads.submission(ctx, inp.course_id, inp.assignment_id, inp.refresh)


@capability(
    name="lms.grade.list",
    summary="The user's grades on Canvas or another LMS for a linked course.",
    description="""The course total first, then one row per assignment, with score, points possible
and grade as the LMS shows them. The gradebook in this app is grading.gradebook.get; to add LMS
assignments to it use lms.assignment.import.""",
    effect="read",
    http=Http("GET", "/courses/{course_id}/lms/grades"),
    expose=HTTP_ONLY,
    tags=TAGS,
    agent_output_fields=(
        "truncated",
        *(
            f"items.{f}"
            for f in (
                "external_id",
                "name",
                "score",
                "points_possible",
                "grade",
                "group_name",
                "graded_at",
                "kind",
            )
        ),
    ),
)
async def grades_list(ctx: Ctx, inp: CourseReadInput) -> GradeList:
    return await reads.grades(ctx, inp.course_id, inp.refresh)


@capability(
    name="lms.module.list",
    summary="Modules of a linked course.",
    description="""Modules are the instructor's outline of the course (weeks or units), in order,
with their state, unlock date and item count. Items of a module: lms.module_item.list.""",
    effect="read",
    http=Http("GET", "/courses/{course_id}/lms/modules"),
    expose=HTTP_ONLY,
    tags=TAGS,
    agent_output_fields=(
        "truncated",
        *(f"items.{f}" for f in ("external_id", "name", "state", "unlock_at", "item_count")),
    ),
)
async def modules_list(ctx: Ctx, inp: CourseReadInput) -> ModuleList:
    return await reads.modules(ctx, inp.course_id, inp.refresh)


@capability(
    name="lms.module_item.list",
    summary="Items of one module of a linked course.",
    description="""Get module_id from lms.module.list. Each item has a kind (page, assignment, file,
quiz, link...) and an indent level. `target` says where an item opens in the app (page, assignment,
file...).""",
    effect="read",
    http=Http("GET", "/courses/{course_id}/lms/modules/{module_id}/items"),
    expose=HTTP_ONLY,
    tags=TAGS,
    agent_output_fields=(
        "truncated",
        *(
            f"items.{f}"
            for f in ("external_id", "title", "kind", "indent", "target", "external_url")
        ),
    ),
)
async def module_items_list(ctx: Ctx, inp: ModuleItemsInput) -> ModuleItemList:
    return await reads.module_items(ctx, inp.course_id, inp.module_id, inp.refresh)


@capability(
    name="lms.page.list",
    summary="Pages of a linked course.",
    description="""Titles and last change only; the course's front page is marked. Read one with
lms.page.get. The syllabus has its own tool, lms.syllabus.get.""",
    effect="read",
    http=Http("GET", "/courses/{course_id}/lms/pages"),
    expose=HTTP_ONLY,
    tags=TAGS,
    agent_output_fields=(
        "truncated",
        *(f"items.{f}" for f in ("ref", "title", "updated_at", "front_page")),
    ),
)
async def pages_list(ctx: Ctx, inp: CourseReadInput) -> PageList:
    return await reads.pages(ctx, inp.course_id, inp.refresh)


@capability(
    name="lms.page.get",
    untrusted=True,
    summary="One page of a linked course; the assistant gets its body as Markdown.",
    description="",
    effect="read",
    http=Http("GET", "/courses/{course_id}/lms/pages/{ref}"),
    expose=HTTP_ONLY,
    tags=TAGS,
    agent_output_fields=("ref", "title", "updated_at", "locked", "html"),
)
async def page_get(ctx: Ctx, inp: PageGetInput) -> PageDetail:
    return await reads.page(ctx, inp.course_id, inp.ref, inp.refresh)


@capability(
    name="lms.quiz.list",
    untrusted=True,
    summary="Quizzes of a linked course.",
    description="""Due, unlock and lock dates, points and question count by default; ask for more
with `fields`. A quiz's score and attempts come with lms.assignment.list (its `assignment_id`);
questions are not available.""",
    effect="read",
    http=Http("GET", "/courses/{course_id}/lms/quizzes"),
    expose=HTTP_ONLY,
    tags=TAGS,
    agent_default_fields=("title", "due_at", "unlock_at", "lock_at", "points", "question_count"),
)
async def quizzes_list(ctx: Ctx, inp: QuizzesInput) -> QuizList:
    return await reads.quizzes(ctx, inp.course_id, inp.refresh)


@capability(
    name="lms.syllabus.get",
    untrusted=True,
    summary="The syllabus of a linked course on Canvas or another LMS.",
    description="To extract its grading scheme use lms.syllabus.import.",
    effect="read",
    http=Http("GET", "/courses/{course_id}/lms/syllabus"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def syllabus_get(ctx: Ctx, inp: CourseReadInput) -> RichText:
    return await reads.syllabus(ctx, inp.course_id, inp.refresh)


@capability(
    name="lms.file.get",
    summary="Details of a file of a linked course.",
    description="""Read its text with lms.file.preview; to search or cite it, save it with
lms.file.save_to_course.""",
    effect="read",
    http=Http("GET", "/courses/{course_id}/lms/files/{file_id}"),
    expose=HTTP_ONLY,
    tags=TAGS,
    agent_output_fields=("external_id", "name", "mime_type", "size_bytes", "updated_at", "locked"),
)
async def file_get(ctx: Ctx, inp: FileInput) -> FileMeta:
    return await reads.file(ctx, inp.course_id, inp.file_id, inp.refresh)


@capability(
    name="lms.folder.get",
    summary="A folder of a linked course's files on the LMS: its subfolders and files.",
    description="""Leave out folder_id for the root folder. Courses that hide their files from
students fail with lms.forbidden; their files are still reachable through modules.""",
    effect="read",
    http=Http("GET", "/courses/{course_id}/lms/folders"),
    expose=HTTP_ONLY,
    tags=TAGS,
    agent_output_fields=(
        "truncated",
        "folder.external_id",
        "folder.name",
        "folder.path",
        "folders.external_id",
        "folders.name",
        "folders.files_count",
        "folders.folders_count",
        "files.external_id",
        "files.name",
        "files.mime_type",
        "files.size_bytes",
        "files.updated_at",
        "files.locked",
    ),
)
async def folder_get(ctx: Ctx, inp: FolderInput) -> FolderListing:
    return await reads.folder(ctx, inp.course_id, inp.folder_id, inp.refresh)


@capability(
    name="lms.file.search",
    summary="Find files of a linked course on the LMS by name.",
    description="""Matches part of the file name, not its contents. Each result says its type, size,
last change and whether it is locked. Browse by folder with lms.folder.get, open one with
lms.file.preview, or copy it into the course's files with lms.file.save_to_course.""",
    effect="read",
    http=Http("GET", "/courses/{course_id}/lms/files"),
    expose=HTTP_ONLY,
    tags=TAGS,
    agent_output_fields=(
        "truncated",
        *(
            f"items.{f}"
            for f in ("external_id", "name", "mime_type", "size_bytes", "updated_at", "locked")
        ),
    ),
)
async def file_search(ctx: Ctx, inp: FileSearchInput) -> FileList:
    return await reads.search_files(ctx, inp.course_id, inp.term, inp.refresh)


@capability(
    name="lms.file.preview",
    untrusted=True,
    summary="The text of a file of a linked course, page by page (PDF, Word, PowerPoint, Excel).",
    description="""Reads it without saving it. To search it or cite it, save it with
lms.file.save_to_course instead.""",
    effect="read",
    http=Http("GET", "/courses/{course_id}/lms/files/{file_id}/preview"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def file_preview(ctx: Ctx, inp: FileInput) -> FilePreview:
    from semestra.modules.lms import files

    return await files.preview(ctx, inp.course_id, inp.file_id, inp.refresh)


@capability(
    name="lms.file.save_to_course",
    summary="Save a file of a linked course on the LMS into the course's files.",
    description="""Takes its ref (`file:<id>`) from lms.content.search or lms.course.outline. It
is then processed like an upload and can be searched (files.document.search), cited and
extracted.""",
    effect="write",
    http=Http("POST", "/courses/{course_id}/lms/files/{file_id}:save"),
    preview=previews.preview_file_save,
    tags=TAGS,
)
async def file_save(ctx: Ctx, inp: FileSaveInput) -> SavedFile:
    from semestra.modules.lms import files

    return await files.save_to_course(ctx, inp)


# --- imports --------------------------------------------------------------------------------


@capability(
    name="lms.course.import",
    summary="Start importing courses from the Program's LMS (reviewed before anything is created).",
    description="""Creates an import the user reviews (imports.session.get); committing it creates
the courses and links them to the LMS in one go.""",
    effect="write",
    http=Http("POST", "/programs/{program_id}/lms/imports:courses"),
    preview=previews.preview_course_import,
    tags=TAGS,
)
async def import_courses(ctx: Ctx, inp: CoursesImportInput) -> ImportStarted:
    return await imports.import_courses(ctx, inp)


@capability(
    name="lms.assignment.import",
    summary="Import a linked course's assignments: worth points into the gradebook, else as tasks.",
    description="""Assignments from lms.assignment.list (`ref`s). With `into` auto (default),
those worth points become assessments (each gets its task), the others tasks; ones imported
before are left out. With `into` gradebook, assignments imported as tasks (`imported_as.kind`
task) become assessments and keep their to-do. Saved at once when nothing needs a decision
(`committed`); otherwise the user reviews it, then commit it like any import
(imports.session.commit).""",
    effect="write",
    http=Http("POST", "/courses/{course_id}/lms/imports:assignments"),
    preview=previews.preview_assignment_import,
    tags=TAGS,
)
async def import_assignments(ctx: Ctx, inp: AssignmentImportInput) -> ImportStarted:
    if inp.into == "gradebook":
        return await imports.add_to_gradebook(ctx, inp)
    return await imports.import_assignments(ctx, inp)


@capability(
    name="lms.assignment.add_to_gradebook",
    summary="Move imported LMS assignments that have no gradebook entry into the gradebook.",
    description="""The app's button; the assistant uses lms.assignment.import with `into`
gradebook.""",
    effect="write",
    http=Http("POST", "/courses/{course_id}/lms/imports:gradebook"),
    preview=previews.preview_add_to_gradebook,
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def add_to_gradebook(ctx: Ctx, inp: AssignmentsImportInput) -> ImportStarted:
    return await imports.add_to_gradebook(ctx, inp)


@capability(
    name="lms.assignment.bind",
    summary="Bind an assessment made by hand to an LMS assignment of its course not imported yet.",
    description="""The assessment then follows the assignment as if imported from it (updates,
handed-in to-do). Nothing of it changes now: the platform's differing due date, weight and grade
are offered to the user to take or keep in the app. Importing an
assignment whose title matches an assessment made by hand binds them already.""",
    effect="write",
    http=Http("PUT", "/assessments/{assessment_id}/lms-assignment"),
    preview=previews.preview_assignment_bind,
    tags=TAGS,
)
async def bind_assignment(ctx: Ctx, inp: AssignmentBindInput) -> AssignmentBinding:
    return await imports.bind_assignment(ctx, inp)


@capability(
    name="lms.assignment.unbind",
    summary="Stop an assessment from following its LMS assignment; it stays as it is.",
    description="""Works for imported and bound assessments; the assignment can then be imported
or bound again.""",
    effect="write",
    http=Http("DELETE", "/assessments/{assessment_id}/lms-assignment"),
    preview=previews.preview_assignment_unbind,
    tags=TAGS,
)
async def unbind_assignment(ctx: Ctx, inp: AssessmentRef) -> AssignmentBinding:
    return await imports.unbind_assignment(ctx, inp)


@capability(
    name="lms.syllabus.import",
    summary="Extract the grading scheme and dates from a linked course's LMS syllabus.",
    description="""Starts an AI extraction the user reviews; needs an AI model. Then wait for it and
commit it like any import (imports.session.get, imports.session.commit).""",
    effect="write",
    http=Http("POST", "/courses/{course_id}/lms/imports:syllabus"),
    tags=TAGS,
)
async def import_syllabus(ctx: Ctx, inp: CourseRef) -> ImportStarted:
    return await imports.import_syllabus(ctx, inp.course_id)


# --- background sync (M09 §4.1) -------------------------------------------------------------


@capability(
    name="lms.sync.status",
    summary="How the Program's LMS sync stands: when it last ran, what it changed and what waits.",
    description="""The status line, its panel and the reminders read this. Not for agents.""",
    effect="read",
    http=Http("GET", "/programs/{program_id}/lms/sync"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def sync_get(ctx: Ctx, inp: ProgramRef) -> SyncStatus:
    return await sync_status.status(ctx, inp.program_id)


@capability(
    name="lms.sync.request",
    summary="Sync the Program's linked courses (or one of them) with the LMS now.",
    description="""Without `force` only the courses not synced in the last half hour (the app
asks on opening); with it all of them (the user's "Sync now"). Runs in the background.""",
    effect="write",
    http=Http("POST", "/programs/{program_id}/lms/sync"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def sync_request(ctx: Ctx, inp: SyncRequestInput) -> SyncQueued:
    queued = await sync.request_sync(ctx, inp.program_id, inp.course_id, force=inp.force)
    return SyncQueued(queued=queued)


@capability(
    name="lms.sync.resolve",
    summary="Settle what the sync asks about an imported item.",
    description="""A conflict: take the platform's values or keep the user's. An item gone from
the platform: delete it here or keep it as made by hand.""",
    effect="write",
    http=Http("POST", "/lms/sync/items/{item_id}:resolve"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def sync_resolve(ctx: Ctx, inp: SyncResolveInput) -> SyncStatus:
    program_id = await sync_assignments.resolve(ctx, inp.item_id, inp.choice)
    return await sync_status.status(ctx, program_id)


@capability(
    name="lms.sync.dismiss",
    summary="Ignore new LMS items (no longer offered), or offer ignored ones again.",
    description="Ignored items stay listed in the sync panel, where they can still be imported.",
    effect="write",
    http=Http("POST", "/programs/{program_id}/lms/sync:dismiss"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def sync_dismiss(ctx: Ctx, inp: SyncDismissInput) -> SyncStatus:
    await sync_assignments.dismiss(ctx, inp.program_id, inp.item_ids, inp.dismissed)
    return await sync_status.status(ctx, inp.program_id)


@capability(
    name="lms.sync.change.revert",
    summary="Put back what the sync changed on an imported item.",
    description="""The field then counts as the user's: the platform's next change to it asks
instead of replacing it.""",
    effect="write",
    http=Http("POST", "/lms/sync/changes/{change_id}:revert"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def sync_revert(ctx: Ctx, inp: SyncChangeRef) -> SyncStatus:
    program_id = await sync_assignments.revert(ctx, inp.change_id)
    return await sync_status.status(ctx, program_id)


@capability(
    name="lms.sync.change.reapply",
    summary="Apply again a sync change that was put back.",
    description="""Undoes `lms.sync.change.revert`: the field gets the platform's value
again.""",
    effect="write",
    http=Http("POST", "/lms/sync/changes/{change_id}:reapply"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def sync_reapply(ctx: Ctx, inp: SyncChangeRef) -> SyncStatus:
    program_id = await sync_assignments.revert(ctx, inp.change_id, undone=False)
    return await sync_status.status(ctx, program_id)
