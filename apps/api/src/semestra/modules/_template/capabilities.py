from semestra.core.capability import Http, capability
from semestra.core.context import Ctx
from semestra.core.jobs import JobOut, enqueue
from semestra.modules._template import service
from semestra.modules._template.schemas import CountdownInput, Echo, EchoInput


@capability(
    name="template.echo.get",
    summary="Echo a text back (module template).",
    description="""Example read capability of the module template.
Do not use for real requests; it does nothing useful.""",
    effect="read",
    http=Http("GET", "/template/echo"),
    tags=("template",),
)
async def echo_get(ctx: Ctx, inp: EchoInput) -> Echo:
    return service.echo(inp.text)


@capability(
    name="template.countdown.start",
    summary="Start a countdown background job (module template).",
    description="""Example write capability of the module template: starts a job that reports
progress and can be cancelled. Do not use for real requests.""",
    effect="write",
    http=Http("POST", "/template/countdown"),
    tags=("template",),
)
async def countdown_start(ctx: Ctx, inp: CountdownInput) -> JobOut:
    return JobOut.of(await enqueue(ctx, "template.countdown", inp))
