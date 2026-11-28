"""MCP server (M12 §5): `/mcp`, Streamable HTTP, for a pasted API token or an OAuth access token.

tools = capabilities exposed to MCP (read-only for `read` tokens; delete actions only with a
`write` token and the user's "allow MCP to delete" preference). Skills reach the client three
ways, all from the same `SKILL.md` files and limited to those whose tools the token may call:
the `load_skill` tool (every client supports tools, so the model can load one itself), prompts
(for the user to start one by hand) and the MCP Skills extension (`skills/list`, `skills/get`
and `skill://` resources, for clients that support it). The server's instructions are the rules
Sem works by (`prompts/rules.md`) plus what differs here (`prompts/mcp.md`). A client that shows
forms has the user confirm a delete, a batch or an import, and pick an id the call left out
(`mcp_elicit`).
"""

import base64
import hashlib
import hmac
import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from functools import partial
from typing import Any

import mcp_types as types
from mcp.server.context import ServerRequestContext
from mcp.server.lowlevel import Server
from mcp.server.request_state import RequestStateBoundary, RequestStateSecurity
from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
from mcp.shared.exceptions import MCPError
from mcp_types._types import MCPModel
from pydantic_ai.messages import BinaryContent
from starlette.datastructures import State
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.types import Receive, Scope, Send

from semestra.core.capability import Capability, registry
from semestra.core.config import Settings
from semestra.core.context import AuthInfo, Ctx, Identity
from semestra.core.errors import AppError
from semestra.modules.agent import mcp_elicit, outcome, service, skills, tools, view
from semestra.modules.agent.context import instructions, prompt
from semestra.modules.agent.runtime import agent_ctx

_IDENTITY = "semestra_mcp_identity"
LOAD_SKILL = "load_skill"
SKILLS_EXTENSION = "io.modelcontextprotocol/skills"


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


# `view_pages` reads what `files.document.read` reads, as images: a token that may call one may
# call the other.
VIEW_NEEDS = "files.document.read"


async def _tools_for(ctx: Ctx, ident: McpIdentity) -> list[Capability]:
    """The tools to list: what `Registry.invoke` would let this token call."""
    out: list[Capability] = []
    for cap in await registry.available(ctx, "mcp"):
        if cap.effect != "read" and not ident.can_write:
            continue
        try:
            await service.check_token_call(ctx, cap)
        except AppError:
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
    found = skills.visible_skills(caps)
    extra = [_view_tool()] if any(c.name == VIEW_NEEDS for c in caps) else []
    forms = mcp_elicit.can_ask(ctx)
    listed = [mcp_elicit.tool_for_forms(_tool(c), c) if forms else _tool(c) for c in caps]
    return types.ListToolsResult(
        tools=listed + extra + ([_load_skill_tool(found)] if found else [])
    )


def _view_tool() -> types.Tool:
    """Sem's `view_pages` (`view.py`): pages of a course file as images, for clients whose model
    can see them; there are no conversation attachments here."""
    return types.Tool(
        name=tools.VIEW_PAGES,
        description=view.description(attachments=False),
        input_schema=view.schema(attachments=False),
        annotations=types.ToolAnnotations(read_only_hint=True),
    )


async def _view(state: State, ident: McpIdentity, args: dict[str, Any]) -> types.CallToolResult:
    async def allowed(c: Ctx) -> bool:
        return any(cap.name == VIEW_NEEDS for cap in await _tools_for(c, ident))

    if "attachment_id" in args or not await _with_ctx(state, ident, allowed):
        return _text({"error": f"Unknown tool {tools.VIEW_PAGES!r}"}, error=True)
    result = await view.view_pages(state, ident.user_id, None, args, actor="mcp")
    if not (result.metadata or {}).get("ok"):
        return types.CallToolResult(
            content=[types.TextContent(type="text", text=str(result.return_value))], is_error=True
        )
    content: list[types.ContentBlock] = []
    parts: list[object] = result.return_value if isinstance(result.return_value, list) else []
    for part in parts:
        if isinstance(part, BinaryContent):
            data = base64.b64encode(part.data).decode()
            content.append(types.ImageContent(type="image", data=data, mime_type=part.media_type))
        else:
            content.append(types.TextContent(type="text", text=str(part)))
    return types.CallToolResult(content=content)


def _load_skill_tool(found: list[skills.Skill]) -> types.Tool:
    """Loads a skill, as `load_capability` does for Sem. What Semestra is, when to use it
    (`prompts/about.md`) and the catalog are in the description: a client may not show the
    server's instructions to the model, but it always shows tools (and a client that searches
    its tools finds this one by those words)."""
    catalog = "\n".join(f"- {s.name}: {tools.for_model(s.description)}" for s in found)
    return types.Tool(
        name=LOAD_SKILL,
        description=(
            f"{prompt('about')}\n\nThis tool loads one of Semestra's skills: a step-by-step "
            "workflow for a common task, with the tools it uses. Load the one that covers the "
            f"user's request before you start it.\n\nSkills:\n{catalog}"
        ),
        input_schema={
            "type": "object",
            "properties": {"name": {"type": "string", "enum": [s.name for s in found]}},
            "required": ["name"],
            "additionalProperties": False,
        },
        annotations=types.ToolAnnotations(read_only_hint=True),
    )


def _workflow(skill: skills.Skill) -> str:
    """A skill as the model reads it over MCP: what Semestra is and this surface's rules
    (`prompts/about.md`, `prompts/mcp-rules.md`: no review step in Semestra, so ask before
    deleting or committing an import; where the Program and term come from), then the body and
    the tools it uses. The rules come with every skill because a client may not give the model
    the server's instructions, and the bodies leave them out."""
    names = ", ".join(tools.tool_name(t) for t in skill.tools)
    return tools.for_model(
        f"{prompt('about')}\n\nWorking in Semestra over MCP:\n{prompt('mcp-rules')}\n\n---\n\n"
        f"{skill.body}\n\nTools this workflow uses: {names}"
    )


def _text(payload: Any, *, error: bool = False) -> types.CallToolResult:
    text = json.dumps(payload, ensure_ascii=False, default=str)
    return types.CallToolResult(
        content=[types.TextContent(type="text", text=text)],
        structured_content=payload if isinstance(payload, dict) else None,
        is_error=error,
    )


async def _call_tool(
    ctx: Any, params: types.CallToolRequestParams
) -> types.CallToolResult | types.InputRequiredResult:
    state, ident = _identity(ctx)
    if params.name == LOAD_SKILL:
        wanted = (params.arguments or {}).get("name")
        found = await _skill_list(state, ident)
        skill = next((s for s in found if s.name == wanted), None)
        if skill is None:
            names = ", ".join(s.name for s in found)
            return _text({"error": f"No skill named {wanted!r}. Skills: {names}"}, error=True)
        return types.CallToolResult(content=[types.TextContent(type="text", text=_workflow(skill))])
    if params.name == tools.VIEW_PAGES:
        return await _view(state, ident, dict(params.arguments or {}))
    name = tools.capability_name(params.name)
    args = dict(params.arguments or {})
    before: Callable[[Ctx], Awaitable[None]] | None = None
    if mcp_elicit.can_ask(ctx):
        step = await _ask(state, ident, name, args, params)
        if isinstance(step, mcp_elicit.Ask):
            return step.result
        if isinstance(step, mcp_elicit.Declined):
            return _text(mcp_elicit.declined_payload())
        if step is not None:
            args = step.args
            before = partial(
                outcome.settle_conflicts,
                cap=registry.get(name),
                args=args,
                keep=step.keep,
                surface="mcp",
            )

    # `Registry.invoke` enforces what a token may call (scope, plugins, the delete preference),
    # the same as on REST routes; `_tools_for` only decides which tools to show.
    auth = AuthInfo(kind="pat", token_id=ident.token_id, scopes=ident.scopes)
    result = await outcome.invoke(
        state, ident.user_id, None, name, args, surface="mcp", auth=auth, before=before
    )
    return _text(result.payload, error=not result.ok)


async def _ask(
    state: State,
    ident: McpIdentity,
    name: str,
    args: dict[str, Any],
    params: types.CallToolRequestParams,
) -> mcp_elicit.Ask | mcp_elicit.Go | mcp_elicit.Declined | None:
    """This round's form, for a write the token may make (None: nothing to ask, the call itself
    says what is wrong)."""

    async def run(c: Ctx) -> mcp_elicit.Ask | mcp_elicit.Go | mcp_elicit.Declined | None:
        cap = next((cap for cap in await _tools_for(c, ident) if cap.name == name), None)
        if cap is None or cap.effect == "read":
            return None
        return await mcp_elicit.step(
            c, cap, args, params.input_responses or {}, params.request_state
        )

    return await _with_ctx(state, ident, run)


async def _skill_list(state: State, ident: McpIdentity) -> list[skills.Skill]:
    """Skills whose tools this token may all call: a read-only token sees no write workflow."""

    async def run(c: Ctx) -> list[skills.Skill]:
        return skills.visible_skills(await _tools_for(c, ident))

    return await _with_ctx(state, ident, run)


async def _list_prompts(ctx: Any, params: Any) -> types.ListPromptsResult:
    state, ident = _identity(ctx)
    found = await _skill_list(state, ident)
    return types.ListPromptsResult(
        prompts=[
            types.Prompt(name=s.name, title=s.title.get("en"), description=s.description)
            for s in found
        ]
    )


async def _get_prompt(ctx: Any, params: types.GetPromptRequestParams) -> types.GetPromptResult:
    state, ident = _identity(ctx)
    skill = next((s for s in await _skill_list(state, ident) if s.name == params.name), None)
    if skill is None:
        raise MCPError(types.INVALID_PARAMS, f"unknown prompt {params.name!r}")
    return types.GetPromptResult(
        description=tools.for_model(skill.description),
        messages=[
            types.PromptMessage(
                role="user", content=types.TextContent(type="text", text=_workflow(skill))
            )
        ],
    )


def _skill_uri(skill: skills.Skill) -> str:
    return f"skill://{skill.name}/{skills.FILENAME}"


def _skill_file(skill: skills.Skill) -> str:
    """`SKILL.md` as clients read it: the frontmatter (terms expanded, capabilities named as
    their tools), then the same text `load_skill` returns."""
    end = skill.text.index("\n---", 3) + len("\n---")
    return f"{tools.for_model(skill.text[:end])}\n\n{_workflow(skill)}\n"


class SkillFile(MCPModel):
    uri: str
    digest: str
    size: int


class SkillEntry(MCPModel):
    uri: str
    frontmatter: dict[str, Any]
    resources: list[SkillFile]


class ListSkillsResult(types.PaginatedResult, types.CacheableResult):
    skills: list[SkillEntry]
    result_type: types.ResultType = "complete"


class GetSkillParams(types.RequestParams):
    uri: str


class GetSkillResult(types.CacheableResult):
    skill: SkillEntry
    result_type: types.ResultType = "complete"


def _entry(skill: skills.Skill) -> SkillEntry:
    text = _skill_file(skill)
    raw = text.encode()
    return SkillEntry(
        uri=_skill_uri(skill),
        frontmatter=skills.parse_frontmatter(text)[0],
        resources=[
            SkillFile(
                uri=_skill_uri(skill),
                digest=f"sha256:{hashlib.sha256(raw).hexdigest()}",
                size=len(raw),
            )
        ],
    )


def _by_uri(found: list[skills.Skill], uri: str) -> skills.Skill:
    skill = next((s for s in found if _skill_uri(s) == uri), None)
    if skill is None:
        raise MCPError(types.INVALID_PARAMS, f"unknown skill {uri!r}")
    return skill


async def _list_skills(ctx: Any, params: types.PaginatedRequestParams) -> ListSkillsResult:
    state, ident = _identity(ctx)
    return ListSkillsResult(skills=[_entry(s) for s in await _skill_list(state, ident)])


async def _get_skill(ctx: Any, params: GetSkillParams) -> GetSkillResult:
    state, ident = _identity(ctx)
    return GetSkillResult(skill=_entry(_by_uri(await _skill_list(state, ident), params.uri)))


async def _list_resources(ctx: Any, params: Any) -> types.ListResourcesResult:
    """Empty: skills are found with `skills/list` (or as prompts); listing their files here
    too would show each one twice in a client's attach menu. `skill://` URIs are still read
    with `resources/read`, which the Skills extension needs."""
    return types.ListResourcesResult(resources=[])


async def _read_resource(
    ctx: Any, params: types.ReadResourceRequestParams
) -> types.ReadResourceResult:
    state, ident = _identity(ctx)
    uri = str(params.uri)
    skill = _by_uri(await _skill_list(state, ident), uri)
    return types.ReadResourceResult(
        contents=[
            types.TextResourceContents(uri=uri, mime_type="text/markdown", text=_skill_file(skill))
        ]
    )


def _principal(ctx: ServerRequestContext[Any, Any]) -> str | None:
    """Whose call a form's answers belong to: the token, so another connection cannot replay
    them."""
    request: Request | None = ctx.request
    ident = request.scope.get("state", {}).get(_IDENTITY) if request is not None else None
    return f"{ident.user_id}:{ident.token_id}" if isinstance(ident, McpIdentity) else None


def make_server(settings: Settings) -> Server[Any]:
    server = Server(
        "semestra",
        version="0.1.0",
        instructions=tools.for_model(instructions("mcp")),
        on_list_tools=_list_tools,
        on_call_tool=_call_tool,
        on_list_prompts=_list_prompts,
        on_get_prompt=_get_prompt,
        on_list_resources=_list_resources,
        on_read_resource=_read_resource,
    )
    server.extensions[SKILLS_EXTENSION] = {}
    # A form's answers ride back in `requestState`, sealed with a key from the instance's secret
    # (any worker can open it), bound to the call, its arguments and the token, for half an hour.
    key = hmac.new(settings.secret_key.encode(), b"semestra-mcp-request-state", "sha256").digest()
    security = RequestStateSecurity(keys=[key], ttl=1800, bind_principal=_principal)
    server.middleware.append(RequestStateBoundary(security, default_audience="semestra"))
    server.add_request_handler("skills/list", types.PaginatedRequestParams, _list_skills)
    server.add_request_handler("skills/get", GetSkillParams, _get_skill)
    return server


def _unauthorized(settings: Settings) -> Response:
    """Points the app at how to sign in (RFC 9728): apps that support OAuth start from here."""
    from semestra.modules.auth.oauth import common

    challenge = (
        f'Bearer resource_metadata="{common.resource_metadata_url(settings)}", '
        f'scope="{" ".join(common.SCOPES)}"'
        if common.available(settings)
        else 'Bearer realm="semestra"'
    )
    return JSONResponse(
        {"error": {"code": "common.unauthenticated", "params": {}, "request_id": None}},
        status_code=401,
        headers={"WWW-Authenticate": challenge},
    )


async def _authenticate(request: Request) -> Identity | None:
    """A pasted token, or an access token the app got by signing in (M12 §5.3)."""
    from semestra.modules.auth.crypto import PAT_PREFIX
    from semestra.modules.auth.oauth.common import ACCESS_PREFIX, authenticate_access_token

    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    token = token.strip()
    if scheme.lower() != "bearer" or not token:
        return None
    state: State = request.app.state
    async with state.session_factory() as db:
        if token.startswith(PAT_PREFIX):
            identity = await state.authenticator(request, Response(), db, state.now())
        elif token.startswith(ACCESS_PREFIX):
            identity = await authenticate_access_token(db, token, state.now())
        else:
            identity = None
        await db.commit()
    return identity if identity is not None and identity.auth.kind == "pat" else None


class McpEndpoint:
    """ASGI app for `/mcp`: authenticates the connection's token, then hands the request to
    the SDK. Stateless, so each request runs its own short-lived session manager in the
    request's task (no app-wide task group to start and stop)."""

    def __init__(self) -> None:
        self.server: Server[Any] | None = None

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        request = Request(scope, receive)
        self.server = self.server or make_server(request.app.state.settings)
        identity = await _authenticate(request)
        if identity is None:
            return await _unauthorized(request.app.state.settings)(scope, receive, send)
        scope.setdefault("state", {})[_IDENTITY] = McpIdentity(
            identity.user.id, identity.auth.scopes, identity.auth.token_id
        )
        manager = StreamableHTTPSessionManager(self.server, stateless=True, json_response=True)
        async with manager.run():
            await manager.handle_request(scope, receive, send)
