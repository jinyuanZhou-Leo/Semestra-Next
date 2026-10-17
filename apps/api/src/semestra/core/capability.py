"""Capability registry (M00 §3.6): define a business operation once, get REST + agent + MCP.

Only the pieces other modules need today are here: registration, the HTTP route generator,
and `registry.list/get/invoke`. The agent/MCP front-ends (M12) consume the registry only.
"""

import inspect
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Annotated, Any, Literal, get_type_hints

from fastapi import Body, Depends, FastAPI, Path, Query
from pydantic import BaseModel, ValidationError, create_model

from semestra.core.context import Ctx, get_capability_ctx, run_after_commit
from semestra.core.errors import AppError

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
    # Agent/MCP callers get only these output fields (HTTP callers get everything).
    agent_output_fields: tuple[str, ...] | None
    input_model: type[BaseModel]
    output_model: type[BaseModel]
    handler: Callable[[Ctx, Any], Awaitable[BaseModel]]
    preview: Callable[[Ctx, Any], Awaitable[Any]] | None = field(default=None, compare=False)

    @property
    def operation_id(self) -> str:
        head, *rest = re.split(r"[._]", self.name)
        return head + "".join(p.capitalize() for p in rest)


class Registry:
    def __init__(self) -> None:
        self._items: dict[str, Capability] = {}

    def register(self, cap: Capability) -> None:
        if cap.name in self._items:
            raise ValueError(f"duplicate capability {cap.name!r}")
        self._items[cap.name] = cap

    def get(self, name: str) -> Capability:
        try:
            return self._items[name]
        except KeyError:
            raise AppError("common.not_found", 404) from None

    def list(self, expose: Surface | None = None, user: object | None = None) -> list[Capability]:
        # `user` is reserved for plugin gating (M10): capabilities of plugins the user has not
        # installed will be filtered out here.
        del user
        caps = sorted(self._items.values(), key=lambda c: c.name)
        return [c for c in caps if expose is None or expose in c.expose]

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
        try:
            inp = cap.input_model.model_validate(raw_args or {})
        except ValidationError as exc:
            errors = [{"loc": list(e["loc"]), "code": e["type"]} for e in exc.errors()]
            raise AppError("common.validation", 422, errors=errors) from exc
        out = await cap.handler(ctx, inp)
        if surface != "http" and cap.agent_output_fields is not None:
            return out.model_dump(include=set(cap.agent_output_fields), mode="json")
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


def mount_http(app: FastAPI, reg: Registry | None = None) -> None:
    """Generate one REST route per capability that declares `http=` and exposes it."""
    from semestra.core.errors import ErrorResponse

    reg = reg or registry
    for cap in reg.list(expose="http"):
        if cap.http is None:
            continue
        app.add_api_route(
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
