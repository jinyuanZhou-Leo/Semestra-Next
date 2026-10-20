"""LMS capabilities (M09 §5). Connection management is HTTP only: credentials never pass
through agents or MCP clients."""

from semestra.core.capability import Http, NoInput, capability
from semestra.core.context import Ctx
from semestra.modules.lms import imports, reads, service
from semestra.modules.lms.schemas.dto import FileMeta, PageDetail, RichText
from semestra.modules.lms.schemas.io import (
    AnnouncementList,
    AnnouncementsInput,
    AssignmentList,
    AssignmentsImportInput,
    BindingSetInput,
    Connection,
    ConnectionCheck,
    ConnectionCreateInput,
    ConnectionDeleted,
    ConnectionDeleteInput,
    ConnectionList,
    ConnectionUpdateInput,
    ConnectionValidateInput,
    CourseLinkState,
    CourseOverview,
    CourseReadInput,
    CourseRef,
    CoursesImportInput,
    ExternalCourseList,
    ExternalCourseListInput,
    FileInput,
    FileSaveInput,
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
    SavedFile,
    UpdatesOutput,
)

HTTP_ONLY = ("http",)
TAGS = ("lms",)

# --- providers and connections --------------------------------------------------------------


@capability(
    name="lms.provider.list",
    summary="LMS platforms the app can connect to, with their features and settings.",
    description="Features the provider lacks are not offered for its connections.",
    effect="read",
    http=Http("GET", "/lms/providers"),
    tags=TAGS,
)
async def providers_list(ctx: Ctx, inp: NoInput) -> ProviderList:
    return ProviderList(items=service.providers())


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
    description="Courses of the Program can only be linked through this connection.",
    effect="read",
    http=Http("GET", "/programs/{program_id}/lms-binding"),
    tags=TAGS,
)
async def binding_get(ctx: Ctx, inp: ProgramRef) -> ProgramBinding:
    return await service.get_binding(ctx, inp.program_id)


@capability(
    name="lms.program.binding.set",
    summary="Bind an LMS connection to a Program.",
    description="Refused while courses of the Program are linked (lms.program_has_links).",
    effect="write",
    http=Http("PUT", "/programs/{program_id}/lms-binding"),
    tags=TAGS,
)
async def binding_set(ctx: Ctx, inp: BindingSetInput) -> ProgramBinding:
    return await service.set_binding(ctx, inp)


@capability(
    name="lms.program.binding.clear",
    summary="Unbind a Program's LMS connection.",
    description="Refused while courses of the Program are linked (lms.program_has_links).",
    effect="write",
    http=Http("DELETE", "/programs/{program_id}/lms-binding"),
    tags=TAGS,
)
async def binding_clear(ctx: Ctx, inp: ProgramRef) -> ProgramBinding:
    return await service.clear_binding(ctx, inp.program_id)


# --- external courses and links -------------------------------------------------------------


@capability(
    name="lms.course.list",
    summary="The user's courses on the LMS bound to a Program, marked when already linked.",
    description="Current-term courses by default; `include_past` for all of them.",
    effect="read",
    http=Http("GET", "/programs/{program_id}/lms/courses"),
    tags=TAGS,
)
async def courses_list(ctx: Ctx, inp: ExternalCourseListInput) -> ExternalCourseList:
    return await service.external_courses(
        ctx, inp.program_id, include_past=inp.include_past, refresh=inp.refresh
    )


@capability(
    name="lms.course.link.get",
    summary="The LMS course a course is linked to, if any.",
    description="Also says which connection the course's Program is bound to.",
    effect="read",
    http=Http("GET", "/courses/{course_id}/lms-link"),
    tags=TAGS,
)
async def link_get(ctx: Ctx, inp: CourseRef) -> CourseLinkState:
    return await service.link_state(ctx, inp.course_id)


@capability(
    name="lms.course.link.set",
    summary="Link a course to a course on its Program's LMS.",
    description="""Uses the Program's bound connection (lms.program_not_configured without one).
An external course can be linked to only one course of the Program
(lms.course_already_linked). If the course is already linked to another external course this fails
with lms.course_link_exists (naming that course) unless replace is true; replacing stops tracking
what was imported through the old link.""",
    effect="write",
    http=Http("PUT", "/courses/{course_id}/lms-link"),
    tags=TAGS,
)
async def link_set(ctx: Ctx, inp: LinkSetInput) -> CourseLinkState:
    return await service.set_link(ctx, inp)


@capability(
    name="lms.course.link.update",
    summary="Turn LMS sync of a linked course on or off.",
    description="Off: no calendar overlay and no update checks; reading still works.",
    effect="write",
    http=Http("PATCH", "/courses/{course_id}/lms-link"),
    tags=TAGS,
)
async def link_update(ctx: Ctx, inp: LinkUpdateInput) -> CourseLinkState:
    return await service.update_link(ctx, inp.course_id, inp.sync_enabled)


@capability(
    name="lms.course.link.sync",
    summary="Refresh the linked LMS course's code, name and term.",
    description="Changes only the link, never the course itself.",
    effect="write",
    http=Http("POST", "/courses/{course_id}/lms-link:sync"),
    tags=TAGS,
)
async def link_sync(ctx: Ctx, inp: CourseRef) -> CourseLinkState:
    return await service.sync_link(ctx, inp.course_id)


@capability(
    name="lms.course.link.delete",
    summary="Unlink a course from its LMS course.",
    description="Imported assessments, tasks and files stay.",
    effect="write",
    http=Http("DELETE", "/courses/{course_id}/lms-link"),
    tags=TAGS,
)
async def link_delete(ctx: Ctx, inp: CourseRef) -> CourseLinkState:
    return await service.delete_link(ctx, inp.course_id)


# --- reads ----------------------------------------------------------------------------------


@capability(
    name="lms.course.overview",
    summary="A linked course on the LMS: details, navigation and supported features.",
    description="Check `features` before using the other lms reads.",
    effect="read",
    http=Http("GET", "/courses/{course_id}/lms"),
    tags=TAGS,
)
async def course_overview(ctx: Ctx, inp: CourseReadInput) -> CourseOverview:
    return await reads.overview(ctx, inp.course_id, inp.refresh)


@capability(
    name="lms.announcement.list",
    untrusted=True,
    summary="Recent announcements of a linked course, newest first.",
    description="",
    effect="read",
    http=Http("GET", "/courses/{course_id}/lms/announcements"),
    tags=TAGS,
)
async def announcements_list(ctx: Ctx, inp: AnnouncementsInput) -> AnnouncementList:
    return await reads.announcements(ctx, inp.course_id, inp.since, inp.refresh)


@capability(
    name="lms.assignment.list",
    untrusted=True,
    summary="Assignments of a linked course, each marked when already imported.",
    description="""To add them to the gradebook or tasks use lms.assignment.import (reviewed by
the user), never the gradebook or task capabilities directly.""",
    effect="read",
    http=Http("GET", "/courses/{course_id}/lms/assignments"),
    tags=TAGS,
)
async def assignments_list(ctx: Ctx, inp: CourseReadInput) -> AssignmentList:
    return await reads.assignments(ctx, inp.course_id, inp.refresh)


@capability(
    name="lms.grade.list",
    summary="The user's grades on the LMS for a linked course.",
    description="The course total first, then one row per assignment.",
    effect="read",
    http=Http("GET", "/courses/{course_id}/lms/grades"),
    tags=TAGS,
)
async def grades_list(ctx: Ctx, inp: CourseReadInput) -> GradeList:
    return await reads.grades(ctx, inp.course_id, inp.refresh)


@capability(
    name="lms.module.list",
    summary="Modules of a linked course.",
    description="Items of a module: lms.module_item.list.",
    effect="read",
    http=Http("GET", "/courses/{course_id}/lms/modules"),
    tags=TAGS,
)
async def modules_list(ctx: Ctx, inp: CourseReadInput) -> ModuleList:
    return await reads.modules(ctx, inp.course_id, inp.refresh)


@capability(
    name="lms.module_item.list",
    summary="Items of one module of a linked course.",
    description="`target` says where an item opens in the app (page, assignment, file...).",
    effect="read",
    http=Http("GET", "/courses/{course_id}/lms/modules/{module_id}/items"),
    tags=TAGS,
)
async def module_items_list(ctx: Ctx, inp: ModuleItemsInput) -> ModuleItemList:
    return await reads.module_items(ctx, inp.course_id, inp.module_id, inp.refresh)


@capability(
    name="lms.page.list",
    summary="Pages of a linked course.",
    description="Read one with lms.page.get.",
    effect="read",
    http=Http("GET", "/courses/{course_id}/lms/pages"),
    tags=TAGS,
)
async def pages_list(ctx: Ctx, inp: CourseReadInput) -> PageList:
    return await reads.pages(ctx, inp.course_id, inp.refresh)


@capability(
    name="lms.page.get",
    untrusted=True,
    summary="One page of a linked course, as cleaned HTML.",
    description="",
    effect="read",
    http=Http("GET", "/courses/{course_id}/lms/pages/{ref}"),
    tags=TAGS,
)
async def page_get(ctx: Ctx, inp: PageGetInput) -> PageDetail:
    return await reads.page(ctx, inp.course_id, inp.ref, inp.refresh)


@capability(
    name="lms.quiz.list",
    untrusted=True,
    summary="Quizzes of a linked course.",
    description="",
    effect="read",
    http=Http("GET", "/courses/{course_id}/lms/quizzes"),
    tags=TAGS,
)
async def quizzes_list(ctx: Ctx, inp: CourseReadInput) -> QuizList:
    return await reads.quizzes(ctx, inp.course_id, inp.refresh)


@capability(
    name="lms.syllabus.get",
    untrusted=True,
    summary="The syllabus of a linked course, as cleaned HTML.",
    description="To extract its grading scheme use lms.syllabus.import.",
    effect="read",
    http=Http("GET", "/courses/{course_id}/lms/syllabus"),
    tags=TAGS,
)
async def syllabus_get(ctx: Ctx, inp: CourseReadInput) -> RichText:
    return await reads.syllabus(ctx, inp.course_id, inp.refresh)


@capability(
    name="lms.file.get",
    summary="Details of a file of a linked course.",
    description="The content: GET /courses/{course_id}/lms/files/{file_id}/content.",
    effect="read",
    http=Http("GET", "/courses/{course_id}/lms/files/{file_id}"),
    tags=TAGS,
)
async def file_get(ctx: Ctx, inp: FileInput) -> FileMeta:
    return await reads.file(ctx, inp.course_id, inp.file_id, inp.refresh)


@capability(
    name="lms.file.save_to_course",
    summary="Save a file of a linked course into the course's files.",
    description="It is then processed like an upload and can be searched and extracted.",
    effect="write",
    http=Http("POST", "/courses/{course_id}/lms/files/{file_id}:save"),
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
    tags=TAGS,
)
async def import_courses(ctx: Ctx, inp: CoursesImportInput) -> ImportStarted:
    return await imports.import_courses(ctx, inp)


@capability(
    name="lms.assignment.import",
    summary="Start importing assignments of a linked course as assessments or tasks.",
    description="""Creates an import the user reviews; each item can be switched between an
assessment and a task there. Assignments imported before are left out.""",
    effect="write",
    http=Http("POST", "/courses/{course_id}/lms/imports:assignments"),
    tags=TAGS,
)
async def import_assignments(ctx: Ctx, inp: AssignmentsImportInput) -> ImportStarted:
    return await imports.import_assignments(ctx, inp)


@capability(
    name="lms.syllabus.import",
    summary="Extract the grading scheme and dates from a linked course's LMS syllabus.",
    description="Starts an AI extraction (imports) the user reviews; needs an AI model.",
    effect="write",
    http=Http("POST", "/courses/{course_id}/lms/imports:syllabus"),
    tags=TAGS,
)
async def import_syllabus(ctx: Ctx, inp: CourseRef) -> ImportStarted:
    return await imports.import_syllabus(ctx, inp.course_id)


@capability(
    name="lms.course.check_updates",
    summary="Imported assignments whose title, due date or points changed on the LMS.",
    description="Put them up for the user's review with lms.course.queue_updates.",
    effect="read",
    http=Http("GET", "/courses/{course_id}/lms/updates"),
    tags=TAGS,
)
async def check_updates(ctx: Ctx, inp: CourseReadInput) -> UpdatesOutput:
    return await imports.check_updates(ctx, inp.course_id, inp.refresh)


@capability(
    name="lms.course.queue_updates",
    summary="Put the LMS changes of imported assignments up for review.",
    description="""Creates an import of the changes and changes nothing itself: they are written
when the import is committed (imports.session.commit) after the user reviewed it.""",
    effect="write",
    http=Http("POST", "/courses/{course_id}/lms/updates:review"),
    tags=TAGS,
)
async def queue_updates(ctx: Ctx, inp: CourseRef) -> ImportStarted:
    return await imports.review_updates(ctx, inp.course_id)
