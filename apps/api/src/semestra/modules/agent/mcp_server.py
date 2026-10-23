"""MCP server (M12 §5): `/mcp`, Streamable HTTP, personal access tokens only.

tools = capabilities exposed to MCP (read-only for `read` tokens; delete actions only with a
`write` token and the user's "allow MCP to delete" preference), prompts = skills, resources =
read-only summaries of programs, terms and courses.
"""

import json
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import mcp_types as types
from mcp.server.lowlevel import Server
from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
from starlette.datastructures import State
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.types import Receive, Scope, Send

from semestra.core.capability import Capability, registry
from semestra.core.context import AuthInfo, Ctx
from semestra.core.errors import AppError
from semestra.modules.agent import outcome, service, skills, tools
from semestra.modules.agent.runtime import agent_ctx

_IDENTITY = "semestra_mcp_identity"


@dataclass(frozen=True)
class McpIdentity:
    user_id: str
    scopes: tuple[str, ...]
    token_id: str | None

    @property
    def can_write(self) -> bool:
        return "write" in self.scopes


def _identity(ctx: Any) -> tuple[State, McpIdentity]:
    request: Request | None = ctx.request
    if request is None:
        raise AppError("common.unauthenticated", 401)
    ident = request.scope.get("state", {}).get(_IDENTITY)
    if not isinstance(ident, McpIdentity):
        raise AppError("common.unauthenticated", 401)
    return request.app.state, ident


async def _with_ctx(state: State, ident: McpIdentity, fn: Callable[[Ctx], Any]) -> Any:
    async with agent_ctx(state, ident.user_id, scope=None, actor="mcp") as ctx:
        ctx.auth = AuthInfo(kind="pat", token_id=ident.token_id, scopes=ident.scopes)
        return await fn(ctx)


async def _tools_for(ctx: Ctx, ident: McpIdentity) -> list[Capability]:
    caps = await registry.available(ctx, "mcp")
    prefs = await service.get_preferences(ctx)
    out: list[Capability] = []
    for cap in caps:
        if cap.effect != "read" and not ident.can_write:
            continue
        if cap.effect == "destructive" and not prefs.mcp_allow_destructive:
            continue
        out.append(cap)
    return out


def _tool(cap: Capability) -> types.Tool:
    schema = tools.input_schema(cap, "mcp")
    return types.Tool(
        name=tools.tool_name(cap.name),
        description=tools.description(cap),
        input_schema=schema,
        annotations=types.ToolAnnotations(
            read_only_hint=cap.effect == "read",
            destructive_hint=cap.effect == "destructive",
        ),
    )


def catalog() -> dict[str, Any]:
    """Every MCP tool and prompt, for the docs site (`semestra capabilities`). What one client
    sees depends on its token's scope, the user's plugins and the delete preference."""
    return {
        "tools": [
            {
                "name": tools.tool_name(c.name),
                "capability": c.name,
                "module": c.name.split(".")[0],
                "effect": c.effect,
                "summary": c.summary,
                "plugin_id": c.plugin_id,
            }
            for c in registry.list("mcp")
        ],
        "prompts": [
            {
                "name": s.name,
                "title": s.title,
                "description": s.description,
                "tools": [tools.tool_name(t) for t in s.tools],
            }
            for s in sorted(skills.all_skills(), key=lambda s: s.name)
        ],
    }


async def _list_tools(ctx: Any, params: Any) -> types.ListToolsResult:
    state, ident = _identity(ctx)

    async def run(c: Ctx) -> list[Capability]:
        return await _tools_for(c, ident)

    caps: list[Capability] = await _with_ctx(state, ident, run)
    return types.ListToolsResult(tools=[_tool(c) for c in caps])


def _text(payload: Any, *, error: bool = False) -> types.CallToolResult:
    text = json.dumps(payload, ensure_ascii=False, default=str)
    return types.CallToolResult(
        content=[types.TextContent(type="text", text=text)],
        structured_content=payload if isinstance(payload, dict) else None,
        is_error=error,
    )


async def _call_tool(ctx: Any, params: types.CallToolRequestParams) -> types.CallToolResult:
    state, ident = _identity(ctx)
    name = tools.capability_name(params.name)

    async def allowed(c: Ctx) -> bool:
        return any(cap.name == name for cap in await _tools_for(c, ident))

    if not await _with_ctx(state, ident, allowed):
        return _text(
            {"error": {"code": "auth.token_scope", "params": {"tool": params.name}}}, error=True
        )
    auth = AuthInfo(kind="pat", token_id=ident.token_id, scopes=ident.scopes)
    result = await outcome.invoke(
        state, ident.user_id, None, name, dict(params.arguments or {}), surface="mcp", auth=auth
    )
    return _text(result.payload, error=not result.ok)


async def _visible_skills(ctx: Ctx, ident: McpIdentity) -> list[skills.Skill]:
    """Skills whose tools this token may all call: a read-only token sees no write workflow."""
    return skills.visible_skills(await _tools_for(ctx, ident))


async def _list_prompts(ctx: Any, params: Any) -> types.ListPromptsResult:
    state, ident = _identity(ctx)

    async def run(c: Ctx) -> list[skills.Skill]:
        return await _visible_skills(c, ident)

    found: list[skills.Skill] = await _with_ctx(state, ident, run)
    return types.ListPromptsResult(
        prompts=[
            types.Prompt(name=s.name, title=s.title.get("en"), description=s.description)
            for s in found
        ]
    )


async def _get_prompt(ctx: Any, params: types.GetPromptRequestParams) -> types.GetPromptResult:
    state, ident = _identity(ctx)

    async def run(c: Ctx) -> list[skills.Skill]:
        return await _visible_skills(c, ident)

    found: list[skills.Skill] = await _with_ctx(state, ident, run)
    skill = next((s for s in found if s.name == params.name), None)
    if skill is None:
        raise ValueError(f"unknown prompt {params.name!r}")
    names = ", ".join(tools.tool_name(t) for t in skill.tools)
    text = f"{tools.for_model(skill.body)}\n\nTools this workflow uses: {names}"
    return types.GetPromptResult(
        description=tools.for_model(skill.description),
        messages=[
            types.PromptMessage(role="user", content=types.TextContent(type="text", text=text))
        ],
    )


async def _list_resources(ctx: Any, params: Any) -> types.ListResourcesResult:
    return types.ListResourcesResult(
        resources=[
            types.Resource(
                uri="semestra://programs",
                name="programs",
                description="The user's programs with their terms.",
                mime_type="application/json",
            )
        ]
    )


async def _list_templates(ctx: Any, params: Any) -> types.ListResourceTemplatesResult:
    return types.ListResourceTemplatesResult(
        resource_templates=[
            types.ResourceTemplate(
                uri_template="semestra://terms/{id}",
                name="term",
                description="A term with its courses.",
                mime_type="application/json",
            ),
            types.ResourceTemplate(
                uri_template="semestra://courses/{id}",
                name="course",
                description="A course and the terms it runs in.",
                mime_type="application/json",
            ),
        ]
    )


async def _resource(c: Ctx, uri: str) -> Any:
    from semestra.modules.academics import service as academics
    from semestra.modules.academics.schemas import CourseListInput

    if uri == "semestra://programs":
        programs = await academics.list_programs(c)
        return [
            {
                **p.model_dump(mode="json", include={"id", "name", "timezone"}),
                "terms": [
                    t.model_dump(mode="json", include={"id", "name", "start_date", "end_date"})
                    for t in await academics.list_terms(c, p.id)
                ],
            }
            for p in programs
        ]
    kind, _, ident = uri.removeprefix("semestra://").partition("/")
    if kind == "terms" and ident:
        term = await academics.term_out(c, await academics.get_term_row(c, ident))
        courses = await academics.list_courses(
            c, CourseListInput(program_id=term.program_id, term_id=term.id)
        )
        return {
            **term.model_dump(mode="json"),
            "courses": [
                course.model_dump(mode="json", include={"id", "code", "title", "credits"})
                for course in courses.items
            ],
        }
    if kind == "courses" and ident:
        return (await academics.course_out(c, await academics.get_course_row(c, ident))).model_dump(
            mode="json"
        )
    raise AppError("common.not_found", 404)


async def _read_resource(
    ctx: Any, params: types.ReadResourceRequestParams
) -> types.ReadResourceResult:
    state, ident = _identity(ctx)
    uri = str(params.uri)

    async def run(c: Ctx) -> Any:
        return await _resource(c, uri)

    data = await _with_ctx(state, ident, run)
    return types.ReadResourceResult(
        contents=[
            types.TextResourceContents(
                uri=uri, mime_type="application/json", text=json.dumps(data, ensure_ascii=False)
            )
        ]
    )


def make_server() -> Server[Any]:
    return Server(
        "semestra",
        version="0.1.0",
        instructions=(
            "Semestra is a student's planner: programs, terms, courses, timetable, grades and "
            "tasks. Read data with the tools; numbers you report must come from tool results. "
            "Prompts are step-by-step workflows for common tasks."
        ),
        on_list_tools=_list_tools,
        on_call_tool=_call_tool,
        on_list_prompts=_list_prompts,
        on_get_prompt=_get_prompt,
        on_list_resources=_list_resources,
        on_list_resource_templates=_list_templates,
        on_read_resource=_read_resource,
    )


def _unauthorized() -> Response:
    return JSONResponse(
        {"error": {"code": "common.unauthenticated", "params": {}, "request_id": None}},
        status_code=401,
        headers={"WWW-Authenticate": 'Bearer realm="semestra"'},
    )


class McpEndpoint:
    """ASGI app for `/mcp`: authenticates the personal access token, then hands the request to
    the SDK. Stateless, so each request runs its own short-lived session manager in the
    request's task (no app-wide task group to start and stop)."""

    def __init__(self) -> None:
        self.server = make_server()

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        request = Request(scope, receive)
        header = request.headers.get("authorization", "")
        scheme, _, token = header.partition(" ")
        from semestra.modules.auth.crypto import PAT_PREFIX

        if scheme.lower() != "bearer" or not token.strip().startswith(PAT_PREFIX):
            return await _unauthorized()(scope, receive, send)
        state: State = request.app.state
        async with state.session_factory() as db:
            identity = await state.authenticator(request, Response(), db, state.now())
            await db.commit()
        if identity is None or identity.auth.kind != "pat":
            return await _unauthorized()(scope, receive, send)
        scope.setdefault("state", {})[_IDENTITY] = McpIdentity(
            identity.user.id, identity.auth.scopes, identity.auth.token_id
        )
        manager = StreamableHTTPSessionManager(self.server, stateless=True, json_response=True)
        async with manager.run():
            await manager.handle_request(scope, receive, send)
