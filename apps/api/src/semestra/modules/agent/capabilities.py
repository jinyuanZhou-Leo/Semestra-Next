"""Session, preference and catalog capabilities (M12 §4). HTTP only: the assistant does not
manage its own sessions, and the auto-approve list must not be widened by a model."""

from pydantic import BaseModel

from semestra.core.capability import Http, NoInput, capability, registry
from semestra.core.context import Ctx
from semestra.modules.agent import service, skills
from semestra.modules.agent.schemas import (
    Preferences,
    PreferencesUpdateInput,
    SessionCreateInput,
    SessionDetail,
    SessionIdInput,
    SessionList,
    SessionListInput,
    SessionOut,
    SessionUpdateInput,
    SkillInfo,
    SkillList,
    StopResult,
    ToolCatalog,
    ToolInfo,
)

HTTP_ONLY = ("http",)
TAGS = ("agent",)


class Deleted(BaseModel):
    deleted: bool


@capability(
    name="agent.session.list",
    summary="List the user's assistant conversations.",
    description="Newest first; pinned ones are sorted by the client.",
    effect="read",
    http=Http("GET", "/agent/sessions"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def session_list(ctx: Ctx, inp: SessionListInput) -> SessionList:
    return SessionList(items=await service.list_sessions(ctx, inp))


@capability(
    name="agent.session.get",
    summary="Get a conversation with its messages and proposals.",
    description="Pending proposals older than 24 hours are reported as expired.",
    effect="read",
    http=Http("GET", "/agent/sessions/{id}"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def session_get(ctx: Ctx, inp: SessionIdInput) -> SessionDetail:
    out = await service.detail(ctx, inp.id)
    await ctx.db.flush()  # expired proposals
    return out


@capability(
    name="agent.session.create",
    summary="Start a new conversation.",
    description="The page scope (Program, term, course) is the conversation's context.",
    effect="write",
    http=Http("POST", "/agent/sessions"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def session_create(ctx: Ctx, inp: SessionCreateInput) -> SessionOut:
    return service.session_out(await service.create_session(ctx, inp.scope))


@capability(
    name="agent.session.update",
    summary="Rename, pin, archive a conversation or change its context.",
    description="Only the fields sent are changed.",
    effect="write",
    http=Http("PATCH", "/agent/sessions/{id}"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def session_update(ctx: Ctx, inp: SessionUpdateInput) -> SessionOut:
    return service.session_out(await service.update_session(ctx, inp))


@capability(
    name="agent.session.delete",
    summary="Delete a conversation with its messages and attachments.",
    description="Cannot be undone.",
    effect="destructive",
    http=Http("DELETE", "/agent/sessions/{id}"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def session_delete(ctx: Ctx, inp: SessionIdInput) -> Deleted:
    await service.delete_session(ctx, inp.id)
    return Deleted(deleted=True)


@capability(
    name="agent.session.stop",
    summary="Stop the answer being generated.",
    description="What was written so far is kept.",
    effect="write",
    http=Http("POST", "/agent/sessions/{id}:stop"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def session_stop(ctx: Ctx, inp: SessionIdInput) -> StopResult:
    row = await service.get_session_row(ctx, inp.id)
    return StopResult(stopped=ctx.state.agent.stop(row.id))


@capability(
    name="agent.preferences.get",
    summary="Get the assistant preferences.",
    description="Which write actions run without a confirmation card; MCP delete permission.",
    effect="read",
    http=Http("GET", "/agent/preferences"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def preferences_get(ctx: Ctx, inp: NoInput) -> Preferences:
    return await service.get_preferences(ctx)


@capability(
    name="agent.preferences.update",
    summary="Change the assistant preferences.",
    description="Only write actions can be auto-approved; delete actions always ask.",
    effect="write",
    http=Http("PATCH", "/agent/preferences"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def preferences_update(ctx: Ctx, inp: PreferencesUpdateInput) -> Preferences:
    return await service.update_preferences(ctx, inp)


@capability(
    name="agent.tools.catalog",
    summary="List every tool the assistant can use for this user.",
    description="Plugin tools appear once the plugin is installed.",
    effect="read",
    http=Http("GET", "/agent/tools"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def tools_catalog(ctx: Ctx, inp: NoInput) -> ToolCatalog:
    available = await registry.available(ctx, "agent")
    return ToolCatalog(
        items=[
            ToolInfo(
                name=c.name,
                module=c.name.split(".")[0],
                summary=c.summary,
                effect=c.effect,
                plugin_id=c.plugin_id,
                core=c.agent_core,
                mcp="mcp" in c.expose,
            )
            for c in available
        ]
    )


@capability(
    name="agent.skills.list",
    summary="List the skills the user can run as slash commands.",
    description="Titles are in both interface languages.",
    effect="read",
    http=Http("GET", "/agent/skills"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def skills_list(ctx: Ctx, inp: NoInput) -> SkillList:
    visible = skills.visible_skills(await registry.available(ctx, "agent"))
    return SkillList(
        items=[
            SkillInfo(
                name=s.name,
                title=s.title,
                command=s.command,
                description=s.description,
                module=s.module,
            )
            for s in visible
        ]
    )
