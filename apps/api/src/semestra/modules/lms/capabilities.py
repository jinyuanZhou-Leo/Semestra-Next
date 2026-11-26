"""LMS capabilities (M09 §5). Connection management is HTTP only: credentials never pass
through agents or MCP clients."""

from semestra.core.capability import Http, NoInput, capability
from semestra.core.context import Ctx
from semestra.modules.lms import (
    announcements,
    assignment,
    imports,
    material_items,
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
)
from semestra.modules.lms.schemas.io import (
    AnnouncementList,
    AnnouncementReadInput,
    AnnouncementsInput,
    AssessmentRef,
    AssignmentBinding,
    AssignmentBindInput,
    AssignmentDetail,
    AssignmentImportInput,
    AssignmentList,
    AssignmentReadInput,
    AssignmentsImportInput,
    AssignmentsInput,
    AssignmentTargets,
    BindingSetInput,
    Connection,
    ConnectionCheck,
    ConnectionCreateInput,
    ConnectionDeleted,
    ConnectionDeleteInput,
    ConnectionList,
    ConnectionUpdateInput,
    ConnectionValidateInput,
    CourseAnnouncement,
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
    HeldMaterials,
    ImportStarted,
    LinkListInput,
    LinkSetInput,
    LinkUpdateInput,
    MaterialsScope,
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
    TermAnnouncementList,
    TermAnnouncementsInput,
    UnreadCounts,
    UnreadInput,
)
from semestra.modules.lms.schemas.sync import (
    MaterialRef,
    SyncChangeRef,
    SyncDismissInput,
    SyncFieldResolveInput,
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
    "external_term", "sync_enabled", "synced_at", "sync_state",
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
    expose=HTTP_ONLY,
    tags=TAGS,
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
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def binding_clear(ctx: Ctx, inp: ProgramRef) -> ProgramBinding:
    return await service.clear_binding(ctx, inp.program_id)


# --- external courses and links -------------------------------------------------------------


@capability(
    name="lms.course.list",
    summary="The user's courses on the Program's {lms}, marked when already linked.",
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
)
async def link_get(ctx: Ctx, inp: CourseRef) -> CourseLinkState:
    return await service.link_state(ctx, inp.course_id)


@capability(
    name="lms.course.link.list",
    summary="Every LMS course link in a Program.",
    description="""Which of the Program's courses are linked, and to which LMS course, in one call
(with term_id, only that term's courses). For one course use lms.course.link.get, which also
says which connection the Program uses.""",
    effect="read",
    http=Http("GET", "/programs/{program_id}/lms-links"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def link_list(ctx: Ctx, inp: LinkListInput) -> CourseLinkList:
    return await service.link_list(ctx, inp.program_id, inp.term_id)


@capability(
    name="lms.course.link.set",
    summary="Link a course to its course on the Program's {lms}.",
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
    description="""`sync_enabled` off: no calendar overlay and no update checks; reading still
works. Whether its materials come in, and how they are kept, are the settings `lms.materials`.
To remove the link altogether use lms.course.link.delete.""",
    effect="write",
    http=Http("PATCH", "/courses/{course_id}/lms-link"),
    expose=HTTP_ONLY,
    tags=TAGS,
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
    expose=HTTP_ONLY,
    tags=TAGS,
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
)
async def course_overview(ctx: Ctx, inp: CourseReadInput) -> CourseOverview:
    return await reads.overview(ctx, inp.course_id, inp.refresh)


@capability(
    name="lms.course.refresh",
    summary="Forget what the app cached about a linked course and sync it now.",
    description="""The Canvas tab's "Refresh": its next reads ask the {lms}, and the sync updates
what the app keeps (assignments, announcements, files). Reads with `refresh` do the first for
one read. Not for agents.""",
    effect="write",
    http=Http("POST", "/courses/{course_id}/lms:refresh"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def course_refresh(ctx: Ctx, inp: CourseRef) -> CourseLinkState:
    await reads.refresh_course(ctx, inp.course_id)
    state = await service.link_state(ctx, inp.course_id)
    if state.link is not None:
        await sync.request_sync(ctx, state.link.program_id, inp.course_id, force=True)
    return state


@capability(
    name="lms.announcement.list",
    summary="Announcements of a linked course on its {lms}, newest first.",
    description="""As the background sync last read them; `pending`: not read yet, but it will.""",
    effect="read",
    http=Http("GET", "/courses/{course_id}/lms/announcements"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def announcements_list(ctx: Ctx, inp: AnnouncementsInput) -> AnnouncementList:
    return await announcements.course_list(ctx, inp.course_id, inp.since)


@capability(
    name="lms.term.announcement.list",
    summary="Announcements of every LMS-linked course of a term, newest first.",
    description="""Each item names its `course_id`. Not for agents: they read one course with
lms.announcement.list.""",
    effect="read",
    http=Http("GET", "/terms/{term_id}/lms/announcements"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def term_announcements_list(ctx: Ctx, inp: TermAnnouncementsInput) -> TermAnnouncementList:
    return await announcements.term_list(ctx, inp.term_id)


@capability(
    name="lms.announcement.unread",
    summary="How many announcements of each linked course of a Program are unread.",
    description="""Optionally only a term's courses; courses with none are left out (the 公告
tab's count). Not for agents.""",
    effect="read",
    http=Http("GET", "/programs/{program_id}/lms/announcements/unread"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def announcements_unread(ctx: Ctx, inp: UnreadInput) -> UnreadCounts:
    return await announcements.unread(ctx, inp.program_id, inp.term_id)


@capability(
    name="lms.announcement.mark_read",
    summary="Mark an announcement read.",
    description="""Read in the app; also on the platform when the user allows Semestra to change
things there (account setting `lms.allow_writes`). Not for agents.""",
    effect="write",
    http=Http("POST", "/courses/{course_id}/lms/announcements/{announcement_id}:read"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def announcement_mark_read(ctx: Ctx, inp: AnnouncementReadInput) -> CourseAnnouncement:
    return await announcements.mark_read(ctx, inp.course_id, inp.announcement_id)


@capability(
    name="lms.assignment.list",
    untrusted=True,
    summary="Assignments and graded quizzes of a linked course on its {lms}, with the "
    "user's scores and the course total, marked when imported.",
    description="""For "what is due", "what is missing" and "what did I get": filter by `state`
and due dates; `include_total` adds the course total. Where the user is with each is `state` and,
beside it, `marks` (missing, late), as the app shows them; read those, not the raw
`submission.missing`/`late` flags (an excused assignment can still carry them).
The answer is what the last sync kept, as of `as_of` (`source: mirror`), or the {lms} just now
(`source: live`); pass `refresh` only when the user wants what is on the {lms} this minute.
Each has a `ref`: lms.content.read gives its text, rubric and the teacher's feedback.
To add them to the gradebook or tasks use lms.assignment.import, never the gradebook or task
capabilities directly.""",
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
        "state",
        "marks",
    ),
)
async def assignments_list(ctx: Ctx, inp: AssignmentsInput) -> AssignmentList:
    return await assignment.course_list(ctx, inp)


@capability(
    name="lms.assignment.get",
    summary="One assignment of the LMS, whole: its description, the user's submission, feedback.",
    description="""What the assignment's details show (M09 §5): the assignment, what the user
handed in, the teacher's comments and rubric scores (match `rubric_scores.criterion_id` with
`assignment.rubric`), and where it is in Semestra: as the last sync kept it, or read from the LMS
now where the sync keeps nothing for it (`source`).""",
    effect="read",
    http=Http("GET", "/courses/{course_id}/lms/assignments/{assignment_id}"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def assignment_get(ctx: Ctx, inp: AssignmentReadInput) -> AssignmentDetail:
    return await assignment.get(
        ctx, inp.course_id, inp.assignment_id, inp.refresh, held_for=inp.held_for
    )


@capability(
    name="lms.assignment.targets",
    summary="The Program's assessments and to-dos that are an LMS assignment.",
    description="""Which assignment each imported assessment or to-do is (read from the
database): what their rows open with lms.assignment.get.""",
    effect="read",
    http=Http("GET", "/programs/{program_id}/lms/assignment-targets"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def assignment_targets(ctx: Ctx, inp: ProgramRef) -> AssignmentTargets:
    return await assignment.targets(ctx, inp.program_id)


@capability(
    name="lms.module.list",
    summary="Modules of a linked course.",
    description="""Modules are the instructor's outline of the course (weeks or units), in order,
with their state, unlock date and item count. Items of a module: lms.module_item.list.""",
    effect="read",
    http=Http("GET", "/courses/{course_id}/lms/modules"),
    expose=HTTP_ONLY,
    tags=TAGS,
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
)
async def pages_list(ctx: Ctx, inp: CourseReadInput) -> PageList:
    return await reads.pages(ctx, inp.course_id, inp.refresh)


@capability(
    name="lms.page.get",
    summary="One page of a linked course; the assistant gets its body as Markdown.",
    description="",
    effect="read",
    http=Http("GET", "/courses/{course_id}/lms/pages/{ref}"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def page_get(ctx: Ctx, inp: PageGetInput) -> PageDetail:
    return await reads.page(ctx, inp.course_id, inp.ref, inp.refresh)


@capability(
    name="lms.quiz.list",
    summary="Quizzes of a linked course.",
    description="""Due, unlock and lock dates, points and question count by default; ask for more
with `fields`. A quiz's score and attempts come with lms.assignment.list (its `assignment_id`);
questions are not available.""",
    effect="read",
    http=Http("GET", "/courses/{course_id}/lms/quizzes"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def quizzes_list(ctx: Ctx, inp: QuizzesInput) -> QuizList:
    return await reads.quizzes(ctx, inp.course_id, inp.refresh)


@capability(
    name="lms.syllabus.get",
    summary="The syllabus of a linked course on its {lms}.",
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
    description="""Read its text with lms.file.preview.""",
    effect="read",
    http=Http("GET", "/courses/{course_id}/lms/files/{file_id}"),
    expose=HTTP_ONLY,
    tags=TAGS,
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
)
async def folder_get(ctx: Ctx, inp: FolderInput) -> FolderListing:
    return await reads.folder(ctx, inp.course_id, inp.folder_id, inp.refresh)


@capability(
    name="lms.file.search",
    summary="Find files of a linked course on the LMS by name.",
    description="""Matches part of the file name, not its contents. Each result says its type, size,
last change and whether it is locked. Browse by folder with lms.folder.get, open one with
lms.file.preview.""",
    effect="read",
    http=Http("GET", "/courses/{course_id}/lms/files"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def file_search(ctx: Ctx, inp: FileSearchInput) -> FileList:
    return await reads.search_files(ctx, inp.course_id, inp.term, inp.refresh)


@capability(
    name="lms.file.preview",
    summary="The text of a file of a linked course, page by page (PDF, Word, PowerPoint, Excel).",
    description="""Reads it without saving it.""",
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
    summary="Save a file of a linked course on the {lms} in Semestra (the course's files).",
    description="""Takes its ref (`file:<id>`) from lms.content.search or lms.course.outline.
Only when the user asks to keep a copy, so it opens after the course closes on the LMS: the
course files usually have the file already, and reading it does not need a copy. A file the
course files have keeps its copy in place; one they don't have is added with a copy.""",
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
before are left out, except one imported as a task only and worth points, which becomes an
assessment and keeps its to-do. With `into` gradebook, assignments imported as tasks (`imported_as.kind`
task) become assessments and keep their to-do. The user reviews it, then commit it like any import
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
    queued = await sync.request_sync(
        ctx, inp.program_id, inp.course_id, force=inp.force, stages=inp.stages
    )
    return SyncQueued(queued=queued)


@capability(
    name="lms.sync.resolve",
    summary="Settle an imported item gone from the platform.",
    description="Delete it here, or keep it as made by hand.",
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
    await sync_assignments.dismiss(ctx, inp.program_id, inp.assignment_ids, inp.dismissed)
    return await sync_status.status(ctx, inp.program_id)


@capability(
    name="lms.sync.field.resolve",
    summary="Answer about one field of an imported item.",
    description="""For a field the sync asks about: take the platform's value or keep the
user's. For a field listed in `lms.sync.status` `different`: take the platform's value back.
A value taken from the platform is logged as a recent change, so it can be put back.""",
    effect="write",
    http=Http("POST", "/lms/sync/items/{item_id}/fields/{field}:resolve"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def sync_field_resolve(ctx: Ctx, inp: SyncFieldResolveInput) -> SyncStatus:
    program_id = await sync_assignments.answer(ctx, inp.item_id, inp.field, inp.choice)
    return await sync_status.status(ctx, program_id)


@capability(
    name="lms.sync.material.restore",
    summary="Bring back a course material the user deleted.",
    description="""It comes in again with a sync of its course, queued now.""",
    effect="write",
    http=Http("POST", "/lms/sync/materials/{material_id}:restore"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def sync_material_restore(ctx: Ctx, inp: MaterialRef) -> SyncStatus:
    program_id = await material_items.restore(ctx, inp.material_id)
    return await sync_status.status(ctx, program_id)


@capability(
    name="lms.sync.material.restore_all",
    summary="Bring back every course material the user deleted in a Program.",
    description="""Each comes in again with a sync of its course, queued now (courses whose
materials don't sync are left alone).""",
    effect="write",
    http=Http("POST", "/programs/{program_id}/lms/sync/materials:restore"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def sync_material_restore_all(ctx: Ctx, inp: ProgramRef) -> SyncStatus:
    await material_items.restore_all(ctx, inp.program_id)
    return await sync_status.status(ctx, inp.program_id)


@capability(
    name="lms.sync.material.remove",
    summary="Remove a course material that can't be read since its area is closed.",
    description="""Only one read from the platform (no copy saved in Semestra): its course file is
deleted, and it is not brought back until restored.""",
    effect="destructive",
    http=Http("POST", "/lms/sync/materials/{material_id}:remove"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def sync_material_remove(ctx: Ctx, inp: MaterialRef) -> SyncStatus:
    program_id = await material_items.remove_unreadable(ctx, inp.material_id)
    return await sync_status.status(ctx, program_id)


@capability(
    name="lms.sync.material.remove_all",
    summary="Remove every course material of a Program that can't be read for now.",
    description="""Only those read from the platform (no copy saved in Semestra); those with a copy
are left alone.""",
    effect="destructive",
    http=Http("POST", "/programs/{program_id}/lms/sync/materials:remove"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def sync_material_remove_all(ctx: Ctx, inp: ProgramRef) -> SyncStatus:
    await material_items.remove_all_unreadable(ctx, inp.program_id)
    return await sync_status.status(ctx, inp.program_id)


@capability(
    name="lms.material.count_left",
    summary="Count the course files left from materials whose sync was turned off.",
    description="""They stay in the course files but no longer follow the platform. One course,
or every linked course.""",
    effect="read",
    http=Http("GET", "/me/lms/materials/held"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def materials_held(ctx: Ctx, inp: MaterialsScope) -> HeldMaterials:
    return await material_items.held(ctx, inp.course_id)


@capability(
    name="lms.material.remove_left",
    summary="Remove the course files left from materials whose sync was turned off.",
    description="""Local copies too, except files the user chose to keep. Turning the materials sync
on again brings them back.""",
    effect="destructive",
    http=Http("POST", "/me/lms/materials:remove"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def materials_remove(ctx: Ctx, inp: MaterialsScope) -> HeldMaterials:
    return await material_items.remove_held(ctx, inp.course_id)


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
