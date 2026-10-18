from semestra.core.events import events
from semestra.core.jobs import JobCtx, job_handler
from semestra.modules._template.schemas import CountdownInput, CountdownResult


@job_handler("template.countdown")
async def countdown(ctx: JobCtx, payload: CountdownInput) -> CountdownResult:
    for done in range(payload.steps):
        await ctx.check_cancelled()
        # `step` is a machine-readable label; the frontend renders its own text.
        await ctx.report(100 * done // payload.steps, f"{done + 1}/{payload.steps}")
    # Delivered after the job's transaction commits, like any other event.
    await events.publish(ctx, "template.countdown.finished", {"job_id": ctx.job_id})
    return CountdownResult(steps_done=payload.steps)
