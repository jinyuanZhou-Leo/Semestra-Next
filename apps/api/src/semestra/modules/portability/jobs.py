from datetime import timedelta

from semestra.core.context import Ctx
from semestra.core.jobs import CoreJob, JobCtx, job_handler, periodic
from semestra.modules.portability import service
from semestra.modules.portability.registry import ImportOptions
from semestra.modules.portability.schemas import (
    AccountDeleteJobInput,
    AccountDeleteJobResult,
    ExportJobInput,
    ExportJobResult,
    ImportJobInput,
    ImportJobResult,
)


async def _export_failed(ctx: Ctx, payload: ExportJobInput, job: CoreJob) -> None:
    await service.mark_failed(ctx, payload.archive_id, job)


async def _import_failed(ctx: Ctx, payload: ImportJobInput, job: CoreJob) -> None:
    await service.mark_failed(ctx, payload.archive_id, job)


@job_handler(
    "portability.export",
    stages=[("collecting", 70), ("saving", 30)],
    on_failure=_export_failed,
)
async def export(ctx: JobCtx, payload: ExportJobInput) -> ExportJobResult:
    size = await service.build_export(ctx, payload.archive_id)
    return ExportJobResult(archive_id=payload.archive_id, size_bytes=size)


# One attempt: a failed import is rolled back and shown to the user, who can start it again.
@job_handler(
    "portability.import",
    max_attempts=1,
    stages=[("reading", 10), ("copying", 50), ("importing", 40)],
    on_failure=_import_failed,
)
async def import_(ctx: JobCtx, payload: ImportJobInput) -> ImportJobResult:
    options = ImportOptions(
        mode=payload.mode,
        program_ids=None if payload.program_ids is None else frozenset(payload.program_ids),
        include_preferences=payload.include_preferences,
    )
    await service.run_import(ctx, payload.archive_id, options)
    return ImportJobResult(archive_id=payload.archive_id)


@job_handler("portability.account_delete", stages=[("deleting", 1)])
async def account_delete(ctx: JobCtx, payload: AccountDeleteJobInput) -> AccountDeleteJobResult:
    """Purges every module in this job's transaction; once that has committed, removes the
    stored files and the auth rows and sends the confirmation email."""
    user_id = ctx.user_id
    await ctx.stage("deleting")
    await service.purge_account(ctx)
    state = ctx.state

    async def finish() -> None:
        await service.finish_account_deletion(state, user_id)
        await service.send_deleted_email(state, payload.email, payload.locale)

    ctx.after_commit.append(finish)
    return AccountDeleteJobResult(user_id=user_id)


@periodic("portability.cleanup", every=timedelta(hours=1))
async def cleanup(ctx: Ctx) -> None:
    await service.cleanup(ctx)
