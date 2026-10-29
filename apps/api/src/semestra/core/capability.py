"""Capability registry (M00 §3.6): define a business operation once, get REST + agent + MCP.

Only the pieces other modules need today are here: registration, the HTTP route generator,
and `registry.list/get/invoke`. The agent/MCP front-ends (M12) consume the registry only.
"""

import inspect
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Annotated, Any, Literal, get_type_hints

from fastapi import APIRouter, Body, Depends, FastAPI, Path, Query
from pydantic import BaseModel, ValidationError, create_model

from semestra.core import agent_output
from semestra.core.context import (
    Ctx,
    get_capability_ctx,
    get_http_capability_ctx,
    run_after_commit,
)
from semestra.core.errors import AppError, validation_error
from semestra.core.labels import Loader

Effect = Literal["read", "write", "destructive"]
Surface = Literal["http", "agent", "mcp"]
ALL_SURFACES: tuple[Surface, ...] = ("http", "agent", "mcp")


class NoInput(BaseModel):
    """Input model for capabilities that take no arguments."""


@dataclass(frozen=True)
class Http:
    method: Literal["GET", "POST", "PUT", "PATCH", "DELETE"]
    path: str


@dataclass(frozen=True)
class Capability:
    name: str
    summary: str
    description: str
    effect: Effect
    http: Http | None
    expose: tuple[Surface, ...]
    tags: tuple[str, ...]
    agent_core: bool
    public: bool
    plugin_id: str | None
    # Agent/MCP callers get only these output fields (HTTP callers get everything); `a.b` keeps
    # field `b` of the object in field `a`.
    agent_output_fields: tuple[str, ...] | None
    # The `fields` agent/MCP callers get when they ask for none (list items keep only these).
    agent_default_fields: tuple[str, ...] | None
    input_model: type[BaseModel]
    output_model: type[BaseModel]
    handler: Callable[[Ctx, Any], Awaitable[BaseModel]]
    preview: Callable[[Ctx, Any], Awaitable[Any]] | None = field(default=None, compare=False)
    # Rules the handler would refuse the input for, checked before anything runs: an agent's
    # write is refused before its confirmation card is shown, not after the user approved it.
    check: Callable[[Ctx, Any], Awaitable[None]] | None = field(default=None, compare=False)
    # Results quote text other people wrote (files, LMS content): agents get them marked as
    # untrusted, and the description says so.
    untrusted: bool = False
    # An update of one record: (the argument holding its id, how it is read). The agent's
    # confirmation card shows each sent field as stored before → after (`core.labels`).
    record: tuple[str, Loader] | None = field(default=None, compare=False)

    @property
    def operation_id(self) -> str:
        head, *rest = re.split(r"[._]", self.name)
        return head + "".join(p.capitalize() for p in rest)


# Returns the plugin ids the ctx user has installed (registered by M10's plugins module).
PluginGate = Callable[[Ctx], Awaitable[set[str]]]
# Fills an argument an agent or MCP client left out from the call's context (M02 registers
# `program_id`: the Program the user is in, or their only one). None leaves it missing.
ContextDefault = Callable[[Ctx], Awaitable[str | None]]


@dataclass(frozen=True)
class ContextArg:
    fill: ContextDefault
    # Appended to the field's description in the schema each surface gets: an agent works in a
    # Program, an MCP client does not.
    notes: dict[Surface, str]


class Registry:
    def __init__(self) -> None:
        self._items: dict[str, Capability] = {}
        self._plugin_gate: PluginGate | None = None
        self._context_args: dict[str, ContextArg] = {}
        self._id_sources: dict[str, str] = {}
        # Bumped whenever something that shapes agent tool schemas changes, so caches built from
        # the registry (`agent.tools`) know when to rebuild.
        self._generation = 0

    @property
    def generation(self) -> int:
        return self._generation

    def names(self) -> frozenset[str]:
        return frozenset(self._items)

    def set_context_default(
        self, field_name: str, fill: ContextDefault, notes: dict[Surface, str]
    ) -> None:
        """Agents and MCP clients may leave out a required `field_name`; it is filled from
        the call's context. HTTP callers still pass it."""
        arg = ContextArg(fill, notes)
        if self._context_args.get(field_name) != arg:  # every app built registers it again
            self._context_args[field_name] = arg
            self._generation += 1

    def set_id_source(self, field_name: str, capability: str) -> None:
        """The capability an agent gets `field_name` (and `<field_name>s`) from, e.g.
        `course_id` from `academics.course.find`. Agent and MCP schemas name it in the field's
        description, so a model never has to guess where an id comes from."""
        if self._id_sources.get(field_name, capability) != capability:
            raise ValueError(f"{field_name} already comes from {self._id_sources[field_name]}")
        if field_name not in self._id_sources:
            self._id_sources[field_name] = capability
            self._generation += 1

    @property
    def id_sources(self) -> dict[str, str]:
        return dict(self._id_sources)

    def context_args(self, cap: Capability) -> dict[str, ContextArg]:
        """The required inputs of `cap` an agent may leave out."""
        fields = cap.input_model.model_fields
        return {
            n: a for n, a in self._context_args.items() if n in fields and fields[n].is_required()
        }

    async def with_context_args(
        self, ctx: Ctx, cap: Capability, args: dict[str, Any]
    ) -> dict[str, Any]:
        out = dict(args)
        for name, arg in self.context_args(cap).items():
            if out.get(name) is None:
                value = await arg.fill(ctx)
                if value is not None:
                    out[name] = value
        return out

    async def validate(
        self, ctx: Ctx, cap: Capability, raw_args: dict[str, Any] | None, surface: Surface
    ) -> BaseModel:
        """The input model for these arguments, after the capability's own `check`. Agents and
        MCP clients get their left-out context arguments filled in first."""
        args = raw_args or {}
        if surface != "http":
            args = await self.with_context_args(ctx, cap, args)
        try:
            inp = cap.input_model.model_validate(args)
        except ValidationError as exc:
            raise validation_error(exc) from exc
        if cap.check is not None:
            # The check reads the surface like the handler does (rules for agents only).
            outer, ctx.surface = ctx.surface, surface
            try:
                await cap.check(ctx, inp)
            finally:
                ctx.surface = outer
        return inp

    def set_plugin_gate(self, gate: PluginGate | None) -> None:
        """Capabilities with a `plugin_id` are refused (`plugins.not_installed`) and left out of
        `available()` unless the gate lists that plugin. Without a gate every plugin counts as
        installed."""
        self._plugin_gate = gate

    async def require_plugin(self, ctx: Ctx, plugin_id: str | None) -> None:
        """Raises `plugins.not_installed` for a plugin the ctx user has not installed, for data
        a plugin owns but reaches through a generic capability (its settings)."""
        gate = self._plugin_gate
        if plugin_id is not None and gate is not None and plugin_id not in await gate(ctx):
            raise AppError("plugins.not_installed", 403, plugin_id=plugin_id)

    def register(self, cap: Capability) -> None:
        if cap.name in self._items:
            raise ValueError(f"duplicate capability {cap.name!r}")
        self._items[cap.name] = cap
        self._generation += 1

    def get(self, name: str) -> Capability:
        try:
            return self._items[name]
        except KeyError:
            raise AppError("common.not_found", 404) from None

    def list(self, expose: Surface | None = None) -> list[Capability]:
        """Every registered capability, regardless of the user's plugins (see `available`)."""
        caps = sorted(self._items.values(), key=lambda c: c.name)
        return [c for c in caps if expose is None or expose in c.expose]

    async def available(self, ctx: Ctx, expose: Surface) -> list[Capability]:
        """What the ctx user can call on a surface: plugin capabilities only when installed.
        The agent and MCP tool lists (M12) use this."""
        caps = self.list(expose)
        if self._plugin_gate is None or not any(c.plugin_id for c in caps):
            return caps
        installed = await self._plugin_gate(ctx)
        return [c for c in caps if c.plugin_id is None or c.plugin_id in installed]

    async def invoke(
        self,
        ctx: Ctx,
        name: str,
        raw_args: dict[str, Any] | None = None,
        surface: Surface = "http",
    ) -> dict[str, Any] | BaseModel:
        cap = self.get(name)
        if surface not in cap.expose:
            raise AppError("common.not_found", 404)
        if ctx.user is None and not cap.public:
            raise AppError("common.unauthenticated", 401)
        if ctx.auth is not None and ctx.auth.kind == "pat":
            # Personal access tokens are for MCP clients: only capabilities exposed to MCP,
            # and the read scope can only call read capabilities.
            if "mcp" not in cap.expose:
                raise AppError("auth.token_scope", 403)
            if cap.effect != "read" and "write" not in ctx.auth.scopes:
                raise AppError("auth.token_scope", 403, required="write")
        gate = self._plugin_gate
        if cap.plugin_id is not None and gate is not None and cap.plugin_id not in await gate(ctx):
            raise AppError("plugins.not_installed", 403, plugin_id=cap.plugin_id)
        inp = await self.validate(ctx, cap, raw_args, surface)
        outer, ctx.surface = ctx.surface, surface
        try:
            out = await cap.handler(ctx, inp)
        finally:
            ctx.surface = outer
        if surface == "http":
            return out
        return await agent_output.shape(ctx, cap, inp, out)


registry = Registry()


def capability(
    *,
    name: str,
    summary: str,
    description: str,
    effect: Effect,
    http: Http | None = None,
    expose: tuple[Surface, ...] = ALL_SURFACES,
    tags: tuple[str, ...] = (),
    agent_core: bool = False,
    public: bool = False,
    plugin_id: str | None = None,
    agent_output_fields: tuple[str, ...] | None = None,
    agent_default_fields: tuple[str, ...] | None = None,
    preview: Callable[[Ctx, Any], Awaitable[Any]] | None = None,
    check: Callable[[Ctx, Any], Awaitable[None]] | None = None,
    untrusted: bool = False,
    record: tuple[str, Loader] | None = None,
    target: Registry | None = None,
) -> Callable[[Callable[[Ctx, Any], Awaitable[Any]]], Callable[[Ctx, Any], Awaitable[Any]]]:
    def decorate(
        fn: Callable[[Ctx, Any], Awaitable[Any]],
    ) -> Callable[[Ctx, Any], Awaitable[Any]]:
        hints = get_type_hints(fn)
        params = [p for p in inspect.signature(fn).parameters if p != "return"]
        if len(params) != 2:
            raise TypeError(f"{name}: a capability takes (ctx, inp)")
        input_model = hints[params[1]]
        output_model = hints["return"]
        for model in (input_model, output_model):
            if not (isinstance(model, type) and issubclass(model, BaseModel)):
                raise TypeError(f"{name}: input and output must be Pydantic models")
        missing = [f"{n}" for n, f in input_model.model_fields.items() if not f.description]
        if missing:
            raise TypeError(f"{name}: input fields need Field(description=...): {missing}")
        (target or registry).register(
            Capability(
                name=name,
                summary=summary,
                description=description,
                effect=effect,
                http=http,
                expose=expose,
                tags=tags,
                agent_core=agent_core,
                public=public,
                plugin_id=plugin_id,
                agent_output_fields=agent_output_fields,
                agent_default_fields=agent_default_fields,
                input_model=input_model,
                output_model=output_model,
                handler=fn,
                preview=preview,
                check=check,
                untrusted=untrusted,
                record=record,
            )
        )
        return fn

    return decorate


def _endpoint_for(cap: Capability, reg: Registry) -> Callable[..., Awaitable[Any]]:
    assert cap.http is not None
    path_names = set(re.findall(r"{(\w+)}", cap.http.path))
    fields = cap.input_model.model_fields
    unknown = path_names - set(fields)
    if unknown:
        raise TypeError(f"{cap.name}: path parameters {unknown} are not input fields")

    params: list[inspect.Parameter] = [
        inspect.Parameter(
            "ctx",
            inspect.Parameter.KEYWORD_ONLY,
            annotation=Annotated[
                Ctx,
                Depends(get_capability_ctx if "mcp" in cap.expose else get_http_capability_ctx),
            ],
        )
    ]
    body_fields: dict[str, Any] = {}
    for fname, finfo in fields.items():
        if fname in path_names:
            params.append(
                inspect.Parameter(
                    fname,
                    inspect.Parameter.KEYWORD_ONLY,
                    annotation=Annotated[finfo.annotation, Path(description=finfo.description)],
                )
            )
        elif cap.http.method in ("GET", "DELETE"):
            default = inspect.Parameter.empty if finfo.is_required() else finfo.get_default()
            params.append(
                inspect.Parameter(
                    fname,
                    inspect.Parameter.KEYWORD_ONLY,
                    default=default,
                    annotation=Annotated[finfo.annotation, Query(description=finfo.description)],
                )
            )
        else:
            body_fields[fname] = (finfo.annotation, finfo)
    body_model: type[BaseModel] | None = None
    if body_fields:
        body_model = create_model(f"{cap.input_model.__name__}Body", **body_fields)
        params.append(
            inspect.Parameter(
                "body",
                inspect.Parameter.KEYWORD_ONLY,
                annotation=Annotated[body_model, Body()],
            )
        )

    async def endpoint(**kwargs: Any) -> Any:
        ctx: Ctx = kwargs.pop("ctx")
        body: BaseModel | None = kwargs.pop("body", None)
        raw: dict[str, Any] = dict(kwargs)
        if body is not None:
            # Keep explicit nulls: for PATCH-style inputs "set to null" differs from "absent".
            raw.update({k: getattr(body, k) for k in body.model_fields_set})
        out = await reg.invoke(ctx, cap.name, raw, "http")
        await ctx.db.commit()
        await run_after_commit(ctx)
        return out

    endpoint.__name__ = cap.operation_id
    endpoint.__signature__ = inspect.Signature(params)  # pyright: ignore[reportAttributeAccessIssue]
    return endpoint


# Generated routers, reused by every app built from the same capabilities (tests build one
# app per test, and generating ~200 routes is most of that cost).
_routers: dict[tuple[int, tuple[int, ...]], APIRouter] = {}


def mount_http(app: FastAPI, reg: Registry | None = None) -> None:
    """Generate one REST route per capability that declares `http=` and exposes it."""
    reg = reg or registry
    caps = [c for c in reg.list(expose="http") if c.http is not None]
    key = (id(reg), tuple(id(c) for c in caps))
    router = _routers.get(key)
    if router is None:
        router = _routers[key] = _router_for(caps, reg)
    app.include_router(router)


def _router_for(caps: list[Capability], reg: Registry) -> APIRouter:
    from semestra.core.errors import ErrorResponse

    router = APIRouter()
    for cap in caps:
        assert cap.http is not None
        router.add_api_route(
            cap.http.path,
            _endpoint_for(cap, reg),
            methods=[cap.http.method],
            operation_id=cap.operation_id,
            response_model=cap.output_model,
            summary=cap.summary,
            description=cap.description,
            tags=list(cap.tags),
            responses={"default": {"model": ErrorResponse}},
        )
    return router
