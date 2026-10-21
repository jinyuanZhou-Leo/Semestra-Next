"""Session, preference and catalog capabilities (M12 §4). HTTP only: the assistant does not
manage its own sessions, and the auto-approve list must not be widened by a model."""

from pydantic import BaseModel

from semestra.core.capability import Http, NoInput, capability, registry
from semestra.core.context import Ctx
from semestra.modules.agent import memory, service, skills
from semestra.modules.agent.schemas import (
    AgentPreferencesOut,
    AgentPreferenceUpdateInput,
    AgentSessionCreateInput,
    AgentSessionDetail,
    AgentSessionList,
    AgentSessionListInput,
    AgentSessionOut,
    AgentSessionUpdateInput,
    AgentSkillInfo,
    AgentSkillList,
    AgentStopResult,
    AgentToolCatalog,
    AgentToolInfo,
    AttachmentIdInput,
    SessionIdInput,
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
async def session_list(ctx: Ctx, inp: AgentSessionListInput) -> AgentSessionList:
    return AgentSessionList(items=await service.list_sessions(ctx, inp))


@capability(
    name="agent.session.get",
    summary="Get a conversation with its messages and proposals.",
    description="Pending proposals older than 24 hours are reported as expired.",
    effect="read",
    http=Http("GET", "/agent/sessions/{id}"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def session_get(ctx: Ctx, inp: SessionIdInput) -> AgentSessionDetail:
    out = await service.detail(ctx, inp.id)
    await ctx.db.flush()  # expired proposals
    return out


@capability(
    name="agent.session.create",
    summary="Start a new conversation.",
    description="""Where the assistant works: a Program or one of its terms. Idempotent per
`client_key`.""",
    effect="write",
    http=Http("POST", "/agent/sessions"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def session_create(ctx: Ctx, inp: AgentSessionCreateInput) -> AgentSessionOut:
    return service.session_out(
        await service.create_session(ctx, inp.scope, inp.client_key, temporary=inp.temporary)
    )


@capability(
    name="agent.session.update",
    summary="Rename, pin, archive a conversation or change where it works.",
    description="Only the fields sent are changed.",
    effect="write",
    http=Http("PATCH", "/agent/sessions/{id}"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def session_update(ctx: Ctx, inp: AgentSessionUpdateInput) -> AgentSessionOut:
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
    name="agent.attachment.delete",
    summary="Remove an uploaded attachment that has not been sent.",
    description="Attachments already part of a message stay until the conversation is deleted.",
    effect="destructive",
    http=Http("DELETE", "/agent/attachments/{id}"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def attachment_delete(ctx: Ctx, inp: AttachmentIdInput) -> Deleted:
    await service.delete_attachment(ctx, inp.id)
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
async def session_stop(ctx: Ctx, inp: SessionIdInput) -> AgentStopResult:
    row = await service.get_session_row(ctx, inp.id)
    return AgentStopResult(stopped=ctx.state.agent.stop(row.id))


@capability(
    name="agent.preference.get",
    summary="Get the assistant preferences.",
    description="Which write actions run without a confirmation card; MCP delete permission.",
    effect="read",
    http=Http("GET", "/agent/preferences"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def preferences_get(ctx: Ctx, inp: NoInput) -> AgentPreferencesOut:
    return await service.get_preferences(ctx)


@capability(
    name="agent.preference.update",
    summary="Change the assistant preferences.",
    description="Only write actions can be auto-approved; delete actions always ask.",
    effect="write",
    http=Http("PATCH", "/agent/preferences"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def preferences_update(ctx: Ctx, inp: AgentPreferenceUpdateInput) -> AgentPreferencesOut:
    return await service.update_preferences(ctx, inp)


@capability(
    name="agent.tool.list",
    summary="List every tool the assistant can use for this user.",
    description="Plugin tools appear once the plugin is installed.",
    effect="read",
    http=Http("GET", "/agent/tools"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def tools_catalog(ctx: Ctx, inp: NoInput) -> AgentToolCatalog:
    available = await registry.available(ctx, "agent")
    return AgentToolCatalog(
        items=[
            AgentToolInfo(
                name=c.name,
                module=c.name.split(".")[0],
                summary=c.summary,
                effect=c.effect,
                plugin_id=c.plugin_id,
                core=c.agent_core,
                mcp="mcp" in c.expose,
                confirm=c.effect != "read" and c.name not in memory.WRITES,
            )
            for c in available
        ]
    )


@capability(
    name="agent.skill.list",
    summary="List the skills the user can run as slash commands.",
    description="Titles are in both interface languages.",
    effect="read",
    http=Http("GET", "/agent/skills"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def skills_list(ctx: Ctx, inp: NoInput) -> AgentSkillList:
    visible = skills.visible_skills(await registry.available(ctx, "agent"))
    return AgentSkillList(
        items=[
            AgentSkillInfo(
                name=s.name,
                title=s.title,
                command=s.command,
                description=s.description,
                module=s.module,
            )
            for s in visible
        ]
    )
