"""M12 AI 助手: the assistant runtime, skills, proposals and the MCP server."""

from fastapi import FastAPI
from starlette.routing import Route

from semestra.modules.agent import capabilities, models  # noqa: F401  (registers on import)
from semestra.modules.agent.mcp_server import McpEndpoint
from semestra.modules.agent.routes import router
from semestra.modules.agent.runtime import AgentRuntime


def register(app: FastAPI) -> None:
    app.state.agent = AgentRuntime()
    app.include_router(router)
    app.router.routes.append(
        Route("/mcp", endpoint=McpEndpoint(), methods=["GET", "POST", "DELETE"])
    )
