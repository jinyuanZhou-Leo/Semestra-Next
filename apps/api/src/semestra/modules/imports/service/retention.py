"""How long import sessions and uploads are kept (M08)."""

from datetime import timedelta

from sqlalchemy import delete, select

from semestra.core.context import Ctx
from semestra.core.storage import get_storage
from semestra.modules.imports.models import ImportsSession, ImportsUpload

RETENTION = timedelta(days=30)


UPLOAD_RETENTION = timedelta(days=1)


async def cleanup(ctx: Ctx) -> None:
    """Sessions are kept 30 days after their last change (import history), whatever their state:
    one left for later and never finished must not hold its uploads (and quota) forever. Uploads
    that never joined a session go after one day."""
    old = (
        await ctx.db.scalars(
            select(ImportsSession).where(ImportsSession.updated_at < ctx.now - RETENTION)
        )
    ).all()
    keys: list[str] = []
    for row in old:
        uploads = (
            await ctx.db.scalars(select(ImportsUpload).where(ImportsUpload.session_id == row.id))
        ).all()
        keys += [u.storage_key for u in uploads]
        await ctx.db.execute(delete(ImportsUpload).where(ImportsUpload.session_id == row.id))
        await ctx.db.delete(row)
    stale = (
        await ctx.db.scalars(
            select(ImportsUpload).where(
                ImportsUpload.session_id.is_(None),
                ImportsUpload.created_at < ctx.now - UPLOAD_RETENTION,
            )
        )
    ).all()
    keys += [u.storage_key for u in stale]
    for upload in stale:
        await ctx.db.delete(upload)
    storage = get_storage(ctx)

    async def _remove() -> None:
        for key in keys:
            await storage.delete(key)

    ctx.after_commit.append(_remove)
