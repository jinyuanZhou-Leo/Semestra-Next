from sqlalchemy import func, select

from semestra.core.context import Ctx
from semestra.core.events import Event, events
from semestra.core.storage import delete_after_commit, storage_usage_provider
from semestra.modules.imports.models import ImportsSession, ImportsUpload


@events.subscribe("academics.program.deleting", in_transaction=True)
async def on_program_deleting(ctx: Ctx, event: Event) -> None:
    """Sessions go with the Program (foreign key); their uploaded files are removed here."""
    rows = (
        await ctx.db.scalars(
            select(ImportsUpload)
            .join(ImportsSession, ImportsSession.id == ImportsUpload.session_id)
            .where(ImportsSession.program_id == event.data["program_id"])
        )
    ).all()
    for row in rows:
        await ctx.db.delete(row)
    delete_after_commit(ctx, [r.storage_key for r in rows])


@storage_usage_provider("imports")
async def usage(ctx: Ctx) -> int:
    total = await ctx.db.scalar(
        select(func.coalesce(func.sum(ImportsUpload.size_bytes), 0)).where(
            ImportsUpload.user_id == ctx.user_id
        )
    )
    return int(total or 0)
