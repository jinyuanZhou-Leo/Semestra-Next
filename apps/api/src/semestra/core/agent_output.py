"""What agent and MCP callers get back from a capability (M00 §3.6). HTTP callers get the output
model as is; agents and MCP clients get a trimmed JSON dict in which:

- only `fields` (or the capability's `agent_default_fields`) of each list item are kept;
- only the capability's `agent_output_fields` are kept (`CHANGED` adds the fields the call set);
- every datetime is in the Program's time zone with its offset (`2026-10-20T10:00:00-04:00`),
  so the model never converts UTC itself;
- fields marked `ForAgents(...)` are converted (LMS HTML becomes Markdown);
- objects in lists leave out their null fields (a term of classes is mostly nulls otherwise).
  Top-level fields keep them: a write that cleared a field says so.

The Program comes from the resolver a module installs with `set_zone_resolver` (academics: the
call's `program_id`, the conversation's scope, ...); with none, times stay UTC.
"""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime, tzinfo
from typing import TYPE_CHECKING, Any, cast

from pydantic import BaseModel

from semestra.core.context import Ctx

if TYPE_CHECKING:
    from semestra.core.capability import Capability

# In `agent_output_fields`: also keep the output fields named like the input fields the call set
# (writes answer with `{id, name, <what changed>}`).
CHANGED = "<changed>"

# Kept whatever `fields` says: what the next call needs (`external_id`: LMS items).
_IDS = {"id", "external_id"}

ZoneResolver = Callable[[Ctx, BaseModel], Awaitable[tzinfo | None]]
_zone_resolver: ZoneResolver | None = None


def set_zone_resolver(fn: ZoneResolver | None) -> None:
    """`fn(ctx, inp)` → the time zone agent output is shown in, or None for UTC."""
    global _zone_resolver
    _zone_resolver = fn


@dataclass(frozen=True)
class ForAgents:
    """Field metadata: agent/MCP callers get `convert(value)` under `name` (default: the field's
    own name). `Annotated[str | None, ForAgents(to_markdown, "markdown")]`."""

    convert: Callable[[str], str | None]
    name: str | None = None


async def shape(ctx: Ctx, cap: Capability, inp: BaseModel, out: BaseModel) -> dict[str, Any]:
    dumped = out.model_dump(mode="json")
    fields: object = getattr(inp, "fields", None) or cap.agent_default_fields
    if isinstance(fields, list | tuple) and fields:
        dumped = _select_fields(dumped, {str(f) for f in fields} | _IDS)  # pyright: ignore[reportUnknownArgumentType, reportUnknownVariableType]
    if cap.agent_output_fields is not None:
        paths = [p for p in cap.agent_output_fields if p != CHANGED]
        if len(paths) < len(cap.agent_output_fields):
            paths += [n for n in inp.model_fields_set if n in dumped and n not in paths]
        dumped = _keep_paths(dumped, tuple(paths))
    zone = await _zone_resolver(ctx, inp) if _zone_resolver is not None else None
    _localize(out, dumped, zone)
    return _drop_nulls_in_lists(dumped)


def _select_fields(dumped: dict[str, Any], keep: set[str]) -> dict[str, Any]:
    """Field selection of list capabilities: agents and MCP clients get only the requested
    fields of each item, to keep their context small."""
    items: object = dumped.get("items")
    if isinstance(items, list):
        dumped["items"] = [
            {k: v for k, v in item.items() if k in keep}  # pyright: ignore[reportUnknownVariableType, reportUnknownMemberType]
            for item in items  # pyright: ignore[reportUnknownVariableType]
            if isinstance(item, dict)
        ]
        return dumped
    return {k: v for k, v in dumped.items() if k in keep}


def _keep_paths(dumped: dict[str, Any], paths: tuple[str, ...]) -> dict[str, Any]:
    """Only these output fields; `a.b` keeps field `b` of the object in field `a`, or of each
    object in the list in field `a`."""
    nested: dict[str, list[str]] = {}  # an empty list keeps the whole field
    for path in paths:
        head, _, rest = path.partition(".")
        kept = nested.setdefault(head, [rest] if rest else [])
        if not rest:
            kept.clear()
        elif kept and rest not in kept:
            kept.append(rest)
    out: dict[str, Any] = {}
    for head, rests in nested.items():
        if head not in dumped:
            continue
        value = dumped[head]
        if rests and isinstance(value, dict):
            out[head] = _keep_paths(value, tuple(rests))  # pyright: ignore[reportUnknownArgumentType]
        elif rests and isinstance(value, list):
            out[head] = [
                _keep_paths(item, tuple(rests)) if isinstance(item, dict) else item  # pyright: ignore[reportUnknownArgumentType]
                for item in value  # pyright: ignore[reportUnknownVariableType]
            ]
        else:
            out[head] = value
    return out


def _localize(value: object, dumped: object, zone: tzinfo | None) -> object:
    """Walks the output model next to its (trimmed) JSON dump and returns the dump's new value:
    datetimes in `zone`, `ForAgents` fields converted. Containers are changed in place."""
    if isinstance(value, datetime):
        if zone is None or not isinstance(dumped, str):
            return dumped
        aware = value if value.tzinfo is not None else value.replace(tzinfo=UTC)
        return aware.astimezone(zone).isoformat()
    if isinstance(value, BaseModel) and isinstance(dumped, dict):
        fields = cast(dict[str, object], dumped)
        for name, info in type(value).model_fields.items():
            if name not in fields:
                continue
            marker = next((m for m in info.metadata if isinstance(m, ForAgents)), None)
            raw: object = getattr(value, name)
            if marker is not None and isinstance(raw, str):
                del fields[name]
                fields[marker.name or name] = marker.convert(raw)
            else:
                fields[name] = _localize(raw, fields[name], zone)
        return fields
    if isinstance(value, list | tuple) and isinstance(dumped, list):
        items = cast(list[object], dumped)
        for i, item in enumerate(cast(list[object] | tuple[object, ...], value)[: len(items)]):
            items[i] = _localize(item, items[i], zone)
        return items
    if isinstance(value, dict) and isinstance(dumped, dict):
        entries = cast(dict[str, object], dumped)
        for key, item in cast(dict[object, object], value).items():
            if isinstance(key, str) and key in entries:
                entries[key] = _localize(item, entries[key], zone)
        return entries
    return dumped


def _drop_nulls_in_lists(value: Any, in_list: bool = False) -> Any:
    if isinstance(value, dict):
        fields = cast(dict[str, object], value)
        return {
            k: _drop_nulls_in_lists(v, in_list)
            for k, v in fields.items()
            if v is not None or not in_list
        }
    if isinstance(value, list):
        return [_drop_nulls_in_lists(v, True) for v in cast(list[object], value)]
    return value
