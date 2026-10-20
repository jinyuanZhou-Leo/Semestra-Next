"""M12 AI 助手: the assistant runtime, skills, proposals and the MCP server."""

from fastapi import FastAPI
from starlette.routing import Route

from semestra.modules.agent import attachments, capabilities, models, portability  # noqa: F401  (registers on import)
from semestra.modules.agent.mcp_server import McpEndpoint
from semestra.modules.agent.routes import router
from semestra.modules.agent.runtime import AgentRuntime
from semestra.modules.agent.settings import AssistantSettings
from semestra.modules.settings import register_settings

register_settings(namespace="assistant", schema=AssistantSettings, levels=("account",))


def register(app: FastAPI) -> None:
    app.state.agent = AgentRuntime()
    app.include_router(router)
    app.router.routes.append(
        Route("/mcp", endpoint=McpEndpoint(), methods=["GET", "POST", "DELETE"])
    )
