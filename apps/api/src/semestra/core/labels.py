"""Names behind ids, for people (M12 §6.1, §3.5): the assistant's chat says "Lab 3", never an id.

Each module names its own records here, in its own package (`<module>/labels.py`): `resolver`
registers how ids of one argument become names, `owned_names` builds the usual one (one query for
all the ids, the user's own rows only). What a write's confirmation card compares before → after
is declared on the capability (`@capability(record=...)`, a `Loader`).
"""

from collections.abc import Awaitable, Callable, Iterable
from typing import Any

from sqlalchemy import select

from semestra.core.context import Ctx
from semestra.core.errors import AppError

# (ctx, ids, the call's arguments) → id → label
Resolver = Callable[[Ctx, list[str], dict[str, Any]], Awaitable[dict[str, str]]]
# (ctx, id) → the record an update is about, as stored (None when it is not the user's)
Loader = Callable[[Ctx, str], Awaitable[Any]]

# Keyed by (a capability name or a prefix of it such as its module, or None for any; the
# argument's name without `_id`/`_ids`). The longest prefix wins.
_RESOLVERS: dict[tuple[str | None, str], Resolver] = {}


def resolver(field: str, module: str | None = None) -> Callable[[Resolver], Resolver]:
    """Registers how ids in `<field>_id`/`<field>_ids` arguments are named, for every capability
    or those under `module` (a capability name or a prefix of it)."""

    def register(fn: Resolver) -> Resolver:
        _RESOLVERS[(module, field)] = fn
        return fn

    return register


def lookup(capability: str, field: str) -> Resolver | None:
    parts = capability.split(".")
    for n in range(len(parts), 0, -1):
        found = _RESOLVERS.get((".".join(parts[:n]), field))
        if found is not None:
            return found
    return _RESOLVERS.get((None, field))


def owned_names(model: type[Any], name: Callable[[Any], str | None]) -> Resolver:
    """Names of the user's own rows of `model`, read in one query."""

    async def resolve(ctx: Ctx, ids: list[str], args: dict[str, Any]) -> dict[str, str]:
        if not ids:
            return {}
        rows = await ctx.db.scalars(
            select(model).where(model.id.in_(set(ids)), model.user_id == ctx.user_id)
        )
        return {row.id: label for row in rows if (label := name(row))}

    return resolve


def owned_row(model: type[Any]) -> Loader:
    """The user's own row of `model` by id."""

    async def load(ctx: Ctx, id_: str) -> Any:
        row = await ctx.db.get(model, id_)
        return row if row is not None and row.user_id == ctx.user_id else None

    return load


async def each(ids: Iterable[str], label: Callable[[str], Awaitable[str | None]]) -> dict[str, str]:
    """Names one id at a time, for labels that need more than one row (a meeting with its
    course); ids that are not the user's are left out."""
    out: dict[str, str] = {}
    for id_ in ids:
        try:
            found = await label(id_)
        except AppError:
            continue
        if found:
            out[id_] = found
    return out
