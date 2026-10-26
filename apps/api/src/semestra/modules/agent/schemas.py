from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

Effect = Literal["read", "write", "destructive"]
ProposalStatus = Literal["pending", "approved", "rejected", "executed", "failed", "expired"]


class AgentScope(BaseModel):
    program_id: str = Field(description="Program the assistant works in.")
    term_id: str | None = Field(default=None, description="Term it works in, if any.")
    course_id: str | None = Field(
        default=None,
        description="Course of older conversations; new ones work in a Program or a term.",
    )


class AgentSessionOut(BaseModel):
    id: str
    title: str | None
    program_id: str | None
    scope: AgentScope | None
    pinned: bool
    temporary: bool
    created_at: datetime
    updated_at: datetime
    archived_at: datetime | None


class AgentSessionList(BaseModel):
    items: list[AgentSessionOut]


class AgentMessageOut(BaseModel):
    id: str
    role: Literal["user", "assistant", "tool"]
    content: list[dict[str, Any]] = Field(
        description="Blocks: text, image_ref, file_ref, skill, tool_call, tool_result, "
        "proposal_ref, citation, note."
    )
    model: str | None
    input_tokens: int | None
    output_tokens: int | None
    created_at: datetime


class AgentProposalOut(BaseModel):
    id: str
    session_id: str
    message_id: str
    call_id: str
    capability: str
    effect: Effect
    args: dict[str, Any]
    input_schema: dict[str, Any] | None = Field(
        description="JSON schema of `args`, for the edit form; only while the card is pending."
    )
    preview: dict[str, Any] | None
    status: ProposalStatus
    result: Any
    display: dict[str, Any] | None = Field(
        default=None,
        description="Names and counts for the step's line once it ran (as in `tool_result`).",
    )
    error_code: str | None
    created_at: datetime
    decided_at: datetime | None
    executed_at: datetime | None


class AgentAttachmentOut(BaseModel):
    id: str
    session_id: str
    kind: Literal["image", "file"]
    name: str
    mime: str
    size: int
    created_at: datetime
    # The course file it was saved as (`agent.attachment.save`).
    file_item_id: str | None = None


class AgentSessionDetail(BaseModel):
    session: AgentSessionOut
    messages: list[AgentMessageOut]
    proposals: list[AgentProposalOut]
    attachments: list[AgentAttachmentOut]
    generating: bool = Field(description="An answer is being generated right now.")
    regenerable: str | None = Field(
        default=None,
        description="The answer that can be regenerated (its first message's id), if any.",
    )


class AgentSessionListInput(BaseModel):
    query: str | None = Field(default=None, description="Matches the title.")
    archived: bool = Field(default=False, description="List archived sessions instead.")
    limit: int = Field(default=100, ge=1, le=500, description="At most this many, newest first.")


class SessionIdInput(BaseModel):
    id: str = Field(description="Session id.")


class AttachmentIdInput(BaseModel):
    id: str = Field(description="Attachment id.")


class AgentSessionCreateInput(BaseModel):
    scope: AgentScope | None = Field(default=None, description="Page scope to start from.")
    client_key: str | None = Field(
        default=None,
        min_length=8,
        max_length=64,
        description="Random key of the new conversation in the client; creating again with "
        "the same key returns the same conversation (double sends, upload and send racing).",
    )
    temporary: bool = Field(
        default=False, description="A temporary chat neither reads nor writes memories."
    )


class AgentSessionUpdateInput(BaseModel):
    id: str = Field(description="Session id.")
    title: str | None = Field(default=None, max_length=200, description="New title.")
    pinned: bool | None = Field(default=None, description="Pin to the top of the list.")
    archived: bool | None = Field(default=None, description="Archive or restore.")
    scope: AgentScope | None = Field(
        default=None, description="Change where the assistant works (a term or the whole Program)."
    )


class AgentPreferencesOut(BaseModel):
    auto_approve: list[str] = Field(description="Write capabilities that run without asking.")
    mcp_allow_destructive: bool = Field(description="MCP clients may run delete actions.")


class AgentPreferenceUpdateInput(BaseModel):
    auto_approve: list[str] | None = Field(
        default=None, description="Write capabilities that run without asking."
    )
    mcp_allow_destructive: bool | None = Field(
        default=None, description="Let MCP clients run delete actions."
    )


class AgentToolInfo(BaseModel):
    name: str
    module: str
    summary: str
    effect: Effect
    plugin_id: str | None
    core: bool = Field(description="Always bound in the assistant.")
    mcp: bool = Field(description="Also offered to MCP clients.")
    confirm: bool = Field(
        description="Changes data behind a confirmation card (memory tools never ask)."
    )


class AgentToolCatalog(BaseModel):
    items: list[AgentToolInfo]


class AgentSkillInfo(BaseModel):
    name: str
    title: dict[str, str]
    command: str | None
    description: str
    module: str


class AgentSkillList(BaseModel):
    items: list[AgentSkillInfo]


class AgentStopResult(BaseModel):
    stopped: bool


# --- streaming routes (not capabilities) --------------------------------------------------


class SendMessageBody(BaseModel):
    text: str = Field(default="", max_length=20_000)
    attachment_ids: list[str] = Field(default_factory=list, max_length=10)
    scope: AgentScope | None = None
    skill: str | None = Field(default=None, description="Slash-command skill to apply.")


class EditMessageBody(BaseModel):
    text: str = Field(default="", max_length=20_000)


class Decision(BaseModel):
    proposal_id: str
    decision: Literal["approve", "reject", "edit"]
    args: dict[str, Any] | None = None
    remember: bool = False
    reason: str | None = Field(default=None, max_length=1000)


class DecideBody(BaseModel):
    decision: Literal["approve", "reject", "edit"]
    args: dict[str, Any] | None = None
    remember: bool = False
    reason: str | None = Field(default=None, max_length=1000)


class DecideManyBody(BaseModel):
    decisions: list[Decision] = Field(min_length=1, max_length=20)
