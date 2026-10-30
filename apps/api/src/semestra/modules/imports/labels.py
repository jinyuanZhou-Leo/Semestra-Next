"""Names of import sessions and their items for the assistant's chat (`core.labels`)."""

from typing import Any

from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.core.labels import owned_names, resolver
from semestra.modules.imports import service
from semestra.modules.imports.models import ImportsSession


def _session_name(row: ImportsSession) -> str | None:
    return ", ".join(str(r["filename"]) for r in row.source_refs if r.get("filename")) or None


resolver("session", module="imports")(owned_names(ImportsSession, _session_name))


@resolver("item", module="imports")
async def item(ctx: Ctx, ids: list[str], args: dict[str, Any]) -> dict[str, str]:
    session_id = args.get("session_id")
    if not isinstance(session_id, str):
        return {}
    try:
        await service.get_session_row(ctx, session_id)
    except AppError:
        return {}
    wanted = set(ids)
    out: dict[str, str] = {}
    for row in await service.session_items(ctx, session_id):
        if row.id not in wanted:
            continue
        data = row.data
        found = data.get("code") or data.get("title") or data.get("section_code")
        if isinstance(found, str) and found:
            out[row.id] = found
    return out
