"""What the chat shows for a tool call (M12 §6.1): names instead of ids, and a few counts; and
the confirmation card of a write without its own preview (M12 §3.5): what changes, before → after.

The model never sees this. Labels are the user's own data (a term's name, a course code, a
file name); the UI words the line in its language around them. A call whose ids cannot be
resolved simply shows fewer details: never an id.
"""

import re
from datetime import date, datetime, time
from decimal import Decimal
from enum import Enum
from typing import Any

from semestra.core.capability import registry
from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.core.labels import lookup

# A `*_ref` value that points at a record: `course:<id>`, `term:<id>`, or an import's `item:<id>`.
_REF = re.compile(r"^(course|term|item):(.+)$")


def _ref(value: Any) -> tuple[str, str] | None:
    found = _REF.match(value) if isinstance(value, str) else None
    return (found.group(1), found.group(2)) if found else None


def _id_fields(args: dict[str, Any]) -> list[tuple[str, list[str]]]:
    """(argument name without `_id`/`_ids`, ids) for every id argument, nested ones included, in
    argument order. A top-level `id` counts as field `id`; a `*_ref` value as its kind."""
    found: list[tuple[str, list[str]]] = []
    if isinstance(args.get("id"), str):
        found.append(("id", [args["id"]]))

    def walk(value: Any) -> None:
        if isinstance(value, list):
            for each in value:  # pyright: ignore[reportUnknownVariableType]
                walk(each)
            return
        if not isinstance(value, dict):
            return
        for key, inner in value.items():  # pyright: ignore[reportUnknownVariableType]
            name = str(key)  # pyright: ignore[reportUnknownArgumentType]
            if name.endswith("_id") and isinstance(inner, str):
                found.append((name.removesuffix("_id"), [inner]))
            elif name.endswith("_ids") and isinstance(inner, list):
                ids = [str(i) for i in inner if isinstance(i, str)]  # pyright: ignore[reportUnknownVariableType]
                found.append((name.removesuffix("_ids"), ids))
            elif name.endswith("_ref") and (ref := _ref(inner)) is not None:
                found.append((ref[0], [ref[1]]))
            else:
                walk(inner)

    walk(args)
    return found


async def labels(ctx: Ctx, capability: str, args: dict[str, Any]) -> list[str]:
    """The names behind the id arguments of a call, in argument order, without repeats."""
    out: list[str] = []
    for field, ids in _id_fields(args):
        fn = lookup(capability, field)
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


# --- confirmation cards of writes without their own preview (M12 §3.5) -----------------------

# Writes that change one existing record: the card shows its values before → after.
_CHANGES_ONE = ("update", "move")


def _value(value: Any) -> Any:
    """A stored value as the card shows it, in the form the model sends it."""
    if isinstance(value, time):
        return value.isoformat(timespec="minutes" if not value.second else "seconds")
    if isinstance(value, date | datetime):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, Enum):
        return value.value
    return value


def _same(before: Any, after: Any) -> bool:
    """Whether a sent value is what is stored: the same moment in another offset is no change."""
    if isinstance(before, str) and isinstance(after, str) and "T" in before and "T" in after:
        try:
            return datetime.fromisoformat(before) == datetime.fromisoformat(after)
        except ValueError:
            pass
    return before == after


# Ids of things in the app's catalog, not records: shown as values the UI names (a kind of card).
_CATALOG = {"card_id": "card"}


def _is_id(key: str) -> bool:
    return key not in _CATALOG and (key in ("id", "fields") or key.endswith(("_id", "_ids")))


async def _shown(ctx: Ctx, capability: str, value: Any, args: dict[str, Any]) -> Any:
    """An argument's value as people read it: without ids (the card names them in `target`),
    `*_ref` values by name (`course: APS105`) and internal refs left out; None when nothing is
    left (an object that only held ids and its `kind`)."""
    if isinstance(value, dict):
        kept: dict[str, Any] = {}
        for k, v in value.items():  # pyright: ignore[reportUnknownVariableType]
            key = str(k)  # pyright: ignore[reportUnknownArgumentType]
            if _is_id(key):
                continue
            if key.endswith("_ref"):
                ref = _ref(v)
                fn = lookup(capability, ref[0]) if ref else None
                found = (await fn(ctx, [ref[1]], args)).get(ref[1]) if ref and fn else None
                if found:
                    kept[key.removesuffix("_ref")] = found
                continue
            shown = await _shown(ctx, capability, v, args)
            if shown is not None:
                kept[key] = shown
        return kept if set(kept) - {"kind"} else None
    if isinstance(value, list):
        items = [await _shown(ctx, capability, v, args) for v in value]  # pyright: ignore[reportUnknownVariableType]
        kept_items = [v for v in items if v is not None]
        return kept_items if kept_items or not value else None
    return value


async def _name_of(ctx: Ctx, capability: str, field: str, id_: Any, args: dict[str, Any]) -> Any:
    if not isinstance(id_, str):
        return None
    fn = lookup(capability, field)
    return (await fn(ctx, [id_], args)).get(id_) if fn is not None else None


async def preview(ctx: Ctx, capability: str, args: dict[str, Any]) -> dict[str, Any]:
    """The card of a write without its own preview: each argument as a change, ids by name.

    For an update (or move) of one record, each sent field shows its stored value before → the
    new one; null shows as cleared, and a changed id (`list_id`) as the names before → after.
    A reorder shows the new order by name. `target` names the remaining ids."""
    verb = capability.rsplit(".", 1)[-1]
    try:
        record = registry.get(capability).record
    except AppError:
        record = None
    primary, load = record or (None, None)
    row: Any = None
    if verb in _CHANGES_ONE and primary and load and isinstance(args.get(primary), str):
        row = await load(ctx, args[primary])
    changes: list[dict[str, Any]] = []
    named: set[str] = set()  # id arguments shown as changes, so not in `target`
    for key, value in args.items():
        if key == primary or key == "fields" or (key == "scope_type" and "scope_id" in args):
            continue  # the scope's kind only says how `target` names it
        if key in _CATALOG:
            changes.append({"field": _CATALOG[key], "after": value})
            named.add(key)
            continue
        if key.endswith("_ids") and verb == "reorder" and isinstance(value, list):
            field = key.removesuffix("_ids")
            names = [await _name_of(ctx, capability, field, v, args) for v in value]  # pyright: ignore[reportUnknownVariableType]
            changes.append({"field": "order", "after": [n for n in names if n]})
            named.add(key)
            continue
        if _is_id(key):
            if row is None or not hasattr(row, key):
                continue
            field = key.removesuffix("_id")
            before = await _name_of(ctx, capability, field, getattr(row, key), args)
            after = await _name_of(ctx, capability, field, value, args)
            named.add(key)
            if value is not None and after is None:
                continue  # an id that names nothing: the card has nothing to say about it
            if value != getattr(row, key):
                changes.append({"field": field, "before": before, "after": after})
            continue
        if value is None:
            # Clearing a value of a record; elsewhere null only means "not given".
            if row is not None:
                change: dict[str, Any] = {"field": key, "after": None}
                if hasattr(row, key):
                    change["before"] = _value(getattr(row, key))
                changes.append(change)
            continue
        if key.endswith("_ref"):
            # `course:<id>` by name; other refs (`source_ref`) are bookkeeping.
            ref = _ref(value)
            name = await _name_of(ctx, capability, ref[0], ref[1], args) if ref else None
            if name:
                changes.append({"field": key.removesuffix("_ref"), "after": name})
            named.add(key)
            continue
        shown = await _shown(ctx, capability, value, args)
        if shown is None:
            continue
        change = {"field": key, "after": shown}
        if row is not None and hasattr(row, key):
            before = _value(getattr(row, key))
            if not _same(before, shown):
                change["before"] = before
        changes.append(change)
    out: dict[str, Any] = {"changes": changes}
    rest = {k: v for k, v in args.items() if k not in named}
    names = await labels(ctx, capability, rest)
    if names:
        out["target"] = " · ".join(names)
    return out
