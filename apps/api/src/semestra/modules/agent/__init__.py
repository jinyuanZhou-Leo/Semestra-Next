"""M12 AI 助手: the assistant runtime, skills, proposals and the MCP server."""

import asyncio
import importlib
from typing import TYPE_CHECKING

from fastapi import FastAPI
from starlette.routing import Route
from starlette.types import Receive, Scope, Send

from semestra.modules.agent import (  # noqa: F401  (registers on import)
    attachments,
    capabilities,
    labels,
    memory,
    models,
    portability,
)
from semestra.modules.agent.routes import router
from semestra.modules.agent.runtime import AgentRuntime
from semestra.modules.agent.settings import AssistantSettings
from semestra.modules.settings import register_settings

if TYPE_CHECKING:
    from semestra.modules.agent.mcp_server import McpEndpoint

register_settings(namespace="assistant", schema=AssistantSettings, levels=("account",))
# Sem must not turn its own memory back on after the user switched it off.
register_settings(
    namespace="memory", schema=memory.MemorySettings, levels=("account",), agent_writable=False
)


class _LazyMcp:
    """`/mcp`, importing the MCP SDK on its first request instead of at start (about half a
    second that every start and reload would pay otherwise)."""

    def __init__(self) -> None:
        self.endpoint: McpEndpoint | None = None

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        endpoint = self.endpoint
        if endpoint is None:
            # Imported off the event loop so other requests keep being served meanwhile.
            mcp_server = await asyncio.to_thread(
                importlib.import_module, "semestra.modules.agent.mcp_server"
            )
            endpoint = self.endpoint = self.endpoint or mcp_server.McpEndpoint()
        await endpoint(scope, receive, send)


def register(app: FastAPI) -> None:
    app.state.agent = AgentRuntime()
    app.include_router(router)
    app.router.routes.append(Route("/mcp", endpoint=_LazyMcp(), methods=["GET", "POST", "DELETE"]))
