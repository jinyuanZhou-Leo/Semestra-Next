from semestra.core.capability import Http, capability
from semestra.core.context import Ctx
from semestra.modules.plugins_builtin.pomodoro import service
from semestra.modules.plugins_builtin.pomodoro.schemas import (
    PLUGIN_ID,
    PomodoroSessionSummarize,
    SessionRecorded,
    SessionRecordInput,
    StatsInput,
)

TAGS = ("pomodoro",)


@capability(
    name="pomodoro.session.record",
    summary="Record a finished pomodoro focus session.",
    description="""Called by the pomodoro card when a focus session completes. Do not use it to
log time the user only mentions in chat: sessions come from the timer.""",
    effect="write",
    http=Http("POST", "/pomodoro/sessions"),
    expose=("http",),
    tags=TAGS,
    plugin_id=PLUGIN_ID,
)
async def session_record(ctx: Ctx, inp: SessionRecordInput) -> SessionRecorded:
    return await service.record(ctx, inp)


@capability(
    name="pomodoro.session.summarize",
    summary="Focus time per day and per course from the pomodoro timer.",
    description="""Use to answer how long the user focused, e.g. "how long did I study APS105 this
week". Pass course_id to limit to one course (find it with academics.course.find). Defaults to the
last 7 days. Days follow the Program's time zone.""",
    effect="read",
    http=Http("GET", "/pomodoro/stats"),
    tags=TAGS,
    plugin_id=PLUGIN_ID,
)
async def stats(ctx: Ctx, inp: StatsInput) -> PomodoroSessionSummarize:
    return await service.stats(ctx, inp)
