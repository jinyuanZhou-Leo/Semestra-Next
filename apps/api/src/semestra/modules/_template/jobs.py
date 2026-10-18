from semestra.core.events import events
from semestra.core.jobs import JobCtx, job_handler
from semestra.modules._template.schemas import CountdownInput, CountdownResult


@job_handler("template.countdown", stages=[("counting", 1)])
async def countdown(ctx: JobCtx, payload: CountdownInput) -> CountdownResult:
    for done in range(payload.steps):
        await ctx.check_cancelled()
        # The stage key is machine-readable; the frontend shows
        # `job_step_template_countdown_counting`.
        await ctx.stage("counting", current=done, total=payload.steps)
    # Delivered after the job's transaction commits, like any other event.
    await events.publish(ctx, "template.countdown.finished", {"job_id": ctx.job_id})
    return CountdownResult(steps_done=payload.steps)
