"""What the chat shows for a tool call (M12 §6.1): names instead of ids, and a few counts.

The model never sees this. Labels are the user's own data (a term's name, a course code, a
file name); the UI words the line in its language around them. A call whose ids cannot be
resolved simply shows fewer details: never an id.
"""

from collections.abc import Awaitable, Callable, Iterable
from typing import Any

from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.modules.academics import service as academics
from semestra.modules.agent.models import AgentAttachment

# (ctx, ids, the call's arguments) → id → label
Resolver = Callable[[Ctx, list[str], dict[str, Any]], Awaitable[dict[str, str]]]

# Keyed by (capability module or None for any, argument name without `_id`/`_ids`).
_RESOLVERS: dict[tuple[str | None, str], Resolver] = {}


def resolver(field: str, module: str | None = None) -> Callable[[Resolver], Resolver]:
    def register(fn: Resolver) -> Resolver:
        _RESOLVERS[(module, field)] = fn
        return fn

    return register


async def _each(
    ids: Iterable[str], label: Callable[[str], Awaitable[str | None]]
) -> dict[str, str]:
    out: dict[str, str] = {}
    for id_ in ids:
        try:
            found = await label(id_)
        except AppError:
            continue
        if found:
            out[id_] = found
    return out


@resolver("program")
async def _program(ctx: Ctx, ids: list[str], args: dict[str, Any]) -> dict[str, str]:
    async def label(id_: str) -> str:
        return (await academics.get_program_row(ctx, id_)).name

    return await _each(ids, label)


@resolver("term")
async def _term(ctx: Ctx, ids: list[str], args: dict[str, Any]) -> dict[str, str]:
    async def label(id_: str) -> str:
        return (await academics.get_term_row(ctx, id_)).name

    return await _each(ids, label)


@resolver("course")
async def _course(ctx: Ctx, ids: list[str], args: dict[str, Any]) -> dict[str, str]:
    async def label(id_: str) -> str:
        row = await academics.get_course_row(ctx, id_)
        return row.code or row.title

    return await _each(ids, label)


@resolver("attachment")
async def _attachment(ctx: Ctx, ids: list[str], args: dict[str, Any]) -> dict[str, str]:
    async def label(id_: str) -> str | None:
        row = await ctx.db.get(AgentAttachment, id_)
        return row.name if row is not None and row.user_id == ctx.user_id else None

    return await _each(ids, label)


@resolver("file_item")
async def _file(ctx: Ctx, ids: list[str], args: dict[str, Any]) -> dict[str, str]:
    from semestra.modules.files import service as files

    async def label(id_: str) -> str:
        return (await files.get_item(ctx, id_)).display_name

    return await _each(ids, label)


@resolver("session", module="imports")
async def _import_session(ctx: Ctx, ids: list[str], args: dict[str, Any]) -> dict[str, str]:
    from semestra.modules.imports import service as imports

    async def label(id_: str) -> str | None:
        row = await imports.get_session_row(ctx, id_)
        names = [str(r["filename"]) for r in row.source_refs if r.get("filename")]
        return ", ".join(names) or None

    return await _each(ids, label)


@resolver("item", module="imports")
async def _import_item(ctx: Ctx, ids: list[str], args: dict[str, Any]) -> dict[str, str]:
    from semestra.modules.imports import service as imports

    session_id = args.get("session_id")
    if not isinstance(session_id, str):
        return {}
    try:
        await imports.get_session_row(ctx, session_id)
    except AppError:
        return {}
    wanted = set(ids)
    out: dict[str, str] = {}
    for item in await imports.items_of(ctx, session_id):
        if item.id not in wanted:
            continue
        data = item.data
        found = data.get("code") or data.get("title") or data.get("section_code")
        if isinstance(found, str) and found:
            out[item.id] = found
    return out


@resolver("item", module="tasks")
async def _task(ctx: Ctx, ids: list[str], args: dict[str, Any]) -> dict[str, str]:
    from semestra.modules.tasks import service as tasks

    async def label(id_: str) -> str:
        return (await tasks.get_item_row(ctx, id_)).title

    return await _each(ids, label)


def _id_fields(args: dict[str, Any]) -> list[tuple[str, list[str]]]:
    """(argument name without `_id`/`_ids`, ids) for every id argument, nested ones included, in
    argument order."""
    found: list[tuple[str, list[str]]] = []

    def walk(value: Any) -> None:
        if not isinstance(value, dict):
            return
        for key, inner in value.items():  # pyright: ignore[reportUnknownVariableType]
            name = str(key)  # pyright: ignore[reportUnknownArgumentType]
            if name.endswith("_id") and isinstance(inner, str):
                found.append((name.removesuffix("_id"), [inner]))
            elif name.endswith("_ids") and isinstance(inner, list):
                ids = [str(i) for i in inner if isinstance(i, str)]  # pyright: ignore[reportUnknownVariableType]
                found.append((name.removesuffix("_ids"), ids))
            else:
                walk(inner)

    walk(args)
    return found


async def labels(ctx: Ctx, capability: str, args: dict[str, Any]) -> list[str]:
    """The names behind the id arguments of a call, in argument order, without repeats."""
    module = capability.split(".", 1)[0]
    out: list[str] = []
    for field, ids in _id_fields(args):
        fn = _RESOLVERS.get((module, field)) or _RESOLVERS.get((None, field))
        if fn is None or not ids:
            continue
        found = await fn(ctx, ids, args)
        out += [found[i] for i in ids if i in found and found[i] not in out]
    return out


def _named(payload: Any) -> str | None:
    """A created or read object's own name (`{name}`, or `{term: {name}}`)."""
    if not isinstance(payload, dict):
        return None
    for key in ("code", "name", "title"):
        value = payload.get(key)  # pyright: ignore[reportUnknownMemberType]
        if isinstance(value, str) and value:
            return value
    objects = [v for v in payload.values() if isinstance(v, dict)]  # pyright: ignore[reportUnknownVariableType]
    return _named(objects[0]) if len(objects) == 1 else None  # pyright: ignore[reportUnknownArgumentType]


async def describe(ctx: Ctx, capability: str, args: dict[str, Any], payload: Any) -> dict[str, Any]:
    """`target`: what the call was about, by name; `count`: how many items it read; and, for
    imports, the session's counts. Keys with nothing to say are left out."""
    out: dict[str, Any] = {}
    names = await labels(ctx, capability, args)
    own = _named(payload)
    if own and own not in names:
        names.append(own)
    if names:
        out["target"] = names
    if isinstance(payload, dict):
        items = payload.get("items")  # pyright: ignore[reportUnknownMemberType]
        if isinstance(items, list):
            out["count"] = len(items)  # pyright: ignore[reportUnknownArgumentType]
        for key in ("changed", "created", "updated", "failed"):
            value = payload.get(key)  # pyright: ignore[reportUnknownMemberType]
            if isinstance(value, int) and not isinstance(value, bool):
                out[key] = value
        summary = payload.get("summary")  # pyright: ignore[reportUnknownMemberType]
        if isinstance(summary, dict) and isinstance(summary.get("accepted"), dict):  # pyright: ignore[reportUnknownMemberType]
            out["accepted"] = summary["accepted"]
            out["issues"] = sum(int(n) for n in (summary.get("issues") or {}).values())  # pyright: ignore[reportUnknownMemberType, reportUnknownArgumentType, reportUnknownVariableType]
    return out
