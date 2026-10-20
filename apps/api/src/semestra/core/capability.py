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

from semestra.core.context import Ctx, get_capability_ctx, run_after_commit
from semestra.core.errors import AppError, validation_error

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

    def tool_spec(self) -> dict[str, Any]:
        """What an agent or MCP client sees: name, description and the input JSON schema."""
        return {
            "name": self.name,
            "description": f"{self.summary}\n\n{self.description}",
            "input_schema": self.input_model.model_json_schema(),
            "effect": self.effect,
        }

    @property
    def operation_id(self) -> str:
        head, *rest = re.split(r"[._]", self.name)
        return head + "".join(p.capitalize() for p in rest)


# Returns the plugin ids the ctx user has installed (registered by M10's plugins module).
PluginGate = Callable[[Ctx], Awaitable[set[str]]]


class Registry:
    def __init__(self) -> None:
        self._items: dict[str, Capability] = {}
        self._plugin_gate: PluginGate | None = None

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
        try:
            inp = cap.input_model.model_validate(raw_args or {})
        except ValidationError as exc:
            raise validation_error(exc) from exc
        outer, ctx.surface = ctx.surface, surface
        try:
            out = await cap.handler(ctx, inp)
        finally:
            ctx.surface = outer
        if surface == "http":
            return out
        fields: object = getattr(inp, "fields", None) or cap.agent_default_fields
        picked: dict[str, Any] | None = None
        if isinstance(fields, list | tuple) and fields:
            picked = _select_fields(out, {str(f) for f in fields} | {"id"})  # pyright: ignore[reportUnknownArgumentType, reportUnknownVariableType]
        if cap.agent_output_fields is not None:
            dumped = picked if picked is not None else out.model_dump(mode="json")
            return _keep_paths(dumped, cap.agent_output_fields)
        return picked if picked is not None else out


def _select_fields(out: BaseModel, keep: set[str]) -> dict[str, Any]:
    """Field selection of list capabilities (M00 §3.6): agents and MCP clients get only the
    requested fields of each item, to keep their context small. HTTP callers get everything."""
    dumped = out.model_dump(mode="json")
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
            annotation=Annotated[Ctx, Depends(get_capability_ctx)],
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
