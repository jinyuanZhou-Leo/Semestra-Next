"""What an MCP client asks the user before a tool runs (M12 §5 "forms"), with the client's
forms: MCP elicitation, over the 2026-07-28 protocol's multi-round requests, so `/mcp` stays
stateless.

Two forms, in this order, each only when needed:

- **pick**: a required `<x>_id` the call left out that the user can pick from
  (`core.labels.choices`: a Program, term or course). The model leaves it out when it does not
  know which one is meant, or several match.
- **confirm**: what the call changes (the same preview as Sem's confirmation card) before it
  deletes, changes several records at once (`Capability.bulk`) or meets data the user has
  (`Capability.conflicts`: each one is a choice on the form, keep what is there or not).

A client that cannot show forms (an older protocol, or no form elicitation) gets neither: its
tools look and run as before, and the rules ask the model to confirm in the chat. Between rounds
the answers so far travel in the request's sealed `requestState` (`mcp_server.make_server`).
"""

import contextlib
import json
import re
from dataclasses import dataclass, field
from datetime import datetime
from functools import cache
from pathlib import Path
from string import Template
from typing import Any

import mcp_types as types
from mcp.server.context import ServerRequestContext
from mcp_types.version import is_version_at_least

from semestra.core.capability import Capability, Conflict, registry
from semestra.core.context import DEFAULT_LOCALE, SUPPORTED_LOCALES, Ctx
from semestra.core.errors import AppError
from semestra.core.labels import choices_for
from semestra.modules.agent import display

PROTOCOL = "2026-07-28"  # the first revision that carries forms inside a tool call's result
PICK = "pick"
CONFIRM = "confirm"
DECLINED = (
    "The user declined in Semestra's form; nothing was changed. Do not call it again unless they "
    "ask."
)

PICK_NOTE = (
    "Leave it out when the user has not said which one, or several match: Semestra asks the user "
    "to pick."
)
CONFIRM_NOTE = (
    "Before this runs, Semestra shows the user what it changes and asks them to confirm (for a "
    "batch, when it changes more than one record): call it without asking in the chat first."
)

_TEXTS = Path(__file__).resolve().parent / "mcp_texts"
_MOMENT = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}")


def can_ask(ctx: ServerRequestContext[Any, Any]) -> bool:
    """Whether this client shows forms inside a tool call: the 2026-07-28 protocol and form
    elicitation (a bare `elicitation: {}` predates modes and means forms)."""
    if not is_version_at_least(ctx.protocol_version, PROTOCOL):
        return False
    found = ctx.session.client_capabilities
    wanted = found.elicitation if found is not None else None
    return wanted is not None and (wanted.form is not None or wanted.url is None)


def pickable(cap: Capability) -> list[str]:
    """The required id arguments of `cap` the user can pick when the call leaves them out."""
    fields = cap.input_model.model_fields
    return [
        name
        for name, info in fields.items()
        if info.is_required() and name.endswith("_id") and choices_for(name[:-3]) is not None
    ]


def may_confirm(cap: Capability) -> bool:
    return cap.effect == "destructive" or cap.bulk or cap.conflicts is not None


def tool_for_forms(tool: types.Tool, cap: Capability) -> types.Tool:
    """The tool as a client that shows forms gets it: pickable ids are optional, and the
    description says when the user is asked."""
    schema = dict(tool.input_schema)
    props: dict[str, Any] = dict(schema.get("properties", {}))
    picks = [name for name in pickable(cap) if name in props]
    for name in picks:
        text = str(props[name].get("description", "")).rstrip(".")
        props[name] = {**props[name], "description": f"{text}. {PICK_NOTE}".lstrip(". ")}
    required = [r for r in schema.get("required", []) if r not in picks]
    schema = {**schema, "properties": props, "required": required}
    if not required:
        schema.pop("required")
    description = tool.description or ""
    if may_confirm(cap):
        description = f"{description}\n\n{CONFIRM_NOTE}"
    return tool.model_copy(update={"input_schema": schema, "description": description})


# --- one round --------------------------------------------------------------------------------


@dataclass
class Ask:
    """Ask the user, then the client calls again with the answer."""

    result: types.InputRequiredResult


@dataclass
class Go:
    """Run the call with these arguments; `keep`: the user's choice for each conflict."""

    args: dict[str, Any]
    keep: dict[str, bool] = field(default_factory=lambda: {})


@dataclass
class Declined:
    pass


def _state(raw: str | None) -> dict[str, Any]:
    """The answers so far. The SDK has already checked the seal: this is what we sent."""
    if not raw:
        return {}
    try:
        found = json.loads(raw)
    except ValueError:
        return {}
    return found if isinstance(found, dict) else {}  # pyright: ignore[reportUnknownVariableType]


def _answer(
    answers: types.InputResponses, key: str, state: dict[str, Any]
) -> types.ElicitResult | None:
    """The answer to the form we asked last round, if this is it."""
    found = answers.get(key)
    return found if state.get("asked") == key and isinstance(found, types.ElicitResult) else None


async def step(
    ctx: Ctx,
    cap: Capability,
    args: dict[str, Any],
    answers: types.InputResponses,
    request_state: str | None,
) -> Ask | Go | Declined:
    """What to do with this round of a call: ask (pick or confirm), give up, or run it."""
    state = _state(request_state)
    picked: dict[str, str] = {
        k: v for k, v in state.get("picked", {}).items() if isinstance(v, str)
    }
    answer = _answer(answers, PICK, state)
    if answer is not None:
        if answer.action != "accept":
            return Declined()
        for name in state.get("fields", []):
            value = (answer.content or {}).get(name)
            if isinstance(value, str):
                picked[name] = value
    call = await registry.with_context_args(ctx, cap, {**args, **picked})
    form = await _pick_form(ctx, cap, call)
    if form is not None:
        fields = list(form.requested_schema["properties"])
        return _ask(PICK, form, {"picked": picked, "asked": PICK, "fields": fields})
    try:
        inp = await registry.validate(ctx, cap, call, "mcp")
        conflicts = await cap.conflicts(ctx, inp) if cap.conflicts is not None else []
    except AppError:
        return Go(call)  # the call itself reports what is wrong
    if not conflicts and not _needs_confirm(cap, call):
        return Go(call)
    answer = _answer(answers, CONFIRM, state)
    if answer is not None:
        if answer.action != "accept":
            return Declined()
        content = answer.content or {}
        keep = {c.key: _kept(c, content.get(c.key)) for c in conflicts}
        return Go(call, {k: v for k, v in keep.items() if v is not None})
    form = await _confirm_form(ctx, cap, call, conflicts)
    return _ask(CONFIRM, form, {"picked": picked, "asked": CONFIRM})


async def resolve(ctx: Ctx, cap: Capability, args: dict[str, Any], keep: dict[str, bool]) -> None:
    """Records the user's choices on the conflicts, in the call's own transaction."""
    if keep and cap.resolve_conflicts is not None:
        inp = await registry.validate(ctx, cap, args, "mcp")
        await cap.resolve_conflicts(ctx, inp, keep)


def _ask(key: str, form: types.ElicitRequestFormParams, state: dict[str, Any]) -> Ask:
    return Ask(
        types.InputRequiredResult(
            input_requests={key: types.ElicitRequest(params=form)},
            request_state=json.dumps(state, separators=(",", ":")),
        )
    )


def _needs_confirm(cap: Capability, args: dict[str, Any]) -> bool:
    """Deleting anything, or a batch naming more than one record (or no list: the whole of
    something, like an import's commit)."""
    if cap.effect == "destructive":
        return True
    if not cap.bulk:
        return False
    sizes = [len(v) for v in args.values() if isinstance(v, list)]  # pyright: ignore[reportUnknownArgumentType]
    return not sizes or max(sizes) > 1


# --- forms ------------------------------------------------------------------------------------


@cache
def catalog(locale: str) -> dict[str, str]:
    if locale not in SUPPORTED_LOCALES:
        locale = DEFAULT_LOCALE
    return json.loads((_TEXTS / f"{locale}.json").read_text(encoding="utf-8"))


@cache
def _labels() -> dict[str, dict[str, str]]:
    """Capability titles, field names and values, copied from the web app's messages
    (`pnpm --filter @semestra/web i18n:groups` writes the file)."""
    return json.loads((_TEXTS / "labels.json").read_text(encoding="utf-8"))


def word(locale: str, key: str, **params: object) -> str:
    return Template(catalog(locale)[key]).safe_substitute(params)


def _label(locale: str, key: str) -> str | None:
    found = _labels().get(locale if locale in SUPPORTED_LOCALES else DEFAULT_LOCALE, {})
    return found.get(key)


def action(locale: str, cap: Capability) -> str:
    key = f"capability_{cap.name.replace('.', '_').replace('-', '_')}_title"
    return _label(locale, key) or cap.summary.rstrip(".")


def field_name(locale: str, name: str) -> str:
    return _label(locale, f"assistant_field_{name}") or name.replace("_", " ")


def value_text(locale: str, value: Any) -> str:
    """A value as people read it: lists as lists, named things by name, moments without
    seconds."""
    if value is None or value == "" or value == []:
        return word(locale, "empty")
    if isinstance(value, bool):
        return word(locale, "yes" if value else "no")
    if isinstance(value, list):
        return word(locale, "list").join(value_text(locale, v) for v in value)  # pyright: ignore[reportUnknownVariableType]
    if isinstance(value, dict):
        for key in ("name", "title", "code"):
            if isinstance(value.get(key), str) and value[key]:  # pyright: ignore[reportUnknownMemberType]
                return str(value[key])  # pyright: ignore[reportUnknownArgumentType]
        return "; ".join(
            f"{field_name(locale, str(k))}: {value_text(locale, v)}"  # pyright: ignore[reportUnknownArgumentType]
            for k, v in value.items()  # pyright: ignore[reportUnknownVariableType]
        )
    if isinstance(value, str) and _MOMENT.match(value):
        try:
            return datetime.fromisoformat(value).strftime("%Y-%m-%d %H:%M")
        except ValueError:
            return value
    return str(value)


async def _pick_form(
    ctx: Ctx, cap: Capability, call: dict[str, Any]
) -> types.ElicitRequestFormParams | None:
    props: dict[str, Any] = {}
    for name in pickable(cap):
        if call.get(name) is not None:
            continue
        source = choices_for(name[:-3])
        options = await source(ctx, call) if source is not None else []
        if not options:
            continue  # nothing to pick: the call reports the missing argument
        props[name] = {
            "type": "string",
            "title": field_name(ctx.locale, name[:-3]),
            "oneOf": [{"const": id_, "title": label} for id_, label in options],
        }
    if not props:
        return None
    return types.ElicitRequestFormParams(
        message=word(ctx.locale, "pick", action=action(ctx.locale, cap)),
        requested_schema={"type": "object", "properties": props, "required": list(props)},
    )


async def _confirm_form(
    ctx: Ctx, cap: Capability, call: dict[str, Any], conflicts: list[Conflict]
) -> types.ElicitRequestFormParams:
    locale = ctx.locale
    preview: dict[str, Any] = {}
    with contextlib.suppress(AppError):  # without it, the form still says what the call is
        preview = await display.make_preview(ctx, cap, call)
    title = action(locale, cap)
    target = preview.get("target")
    lines = [word(locale, "head", action=title, target=target) if target else title]
    for change in preview.get("changes") or []:
        if not isinstance(change, dict) or not isinstance(change.get("field"), str):
            continue
        name = field_name(locale, change["field"])
        after = value_text(locale, change.get("after"))
        if "before" in change:
            before = value_text(locale, change["before"])
            lines.append(f"· {word(locale, 'change', field=name, before=before, after=after)}")
        else:
            lines.append(f"· {word(locale, 'change_new', field=name, after=after)}")
    lines += ["", word(locale, "conflicts" if conflicts else "confirm")]
    props = {c.key: _conflict_prop(locale, c) for c in conflicts}
    schema: dict[str, Any] = {"type": "object", "properties": props}
    if props:
        schema["required"] = list(props)
    return types.ElicitRequestFormParams(
        message="\n".join(lines),
        requested_schema=schema,
    )


_KEEP = {"overwrite": ("keep", "replace"), "duplicate": ("skip", "add")}


def _conflict_prop(locale: str, conflict: Conflict) -> dict[str, Any]:
    keep, other = _KEEP[conflict.kind]
    if conflict.kind == "overwrite":
        title = f"{conflict.subject} · {field_name(locale, conflict.field or '')}"
        options = [
            {
                "const": keep,
                "title": word(locale, "keep", value=value_text(locale, conflict.before)),
            },
            {
                "const": other,
                "title": word(locale, "replace", value=value_text(locale, conflict.after)),
            },
        ]
    else:
        title = conflict.subject
        options = [
            {"const": keep, "title": word(locale, "skip")},
            {"const": other, "title": word(locale, "add")},
        ]
    return {
        "type": "string",
        "title": title,
        "oneOf": options,
        "default": keep if conflict.keep else other,
    }


def _kept(conflict: Conflict, value: Any) -> bool | None:
    """The user's choice on a conflict: keep what is there; None when not answered."""
    keep, other = _KEEP[conflict.kind]
    if value == keep:
        return True
    if value == other:
        return False
    return None


def declined_payload() -> dict[str, Any]:
    return {"rejected": True, "message": DECLINED}
