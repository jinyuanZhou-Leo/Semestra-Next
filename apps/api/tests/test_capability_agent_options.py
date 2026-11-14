"""Options that only shape what Sem and MCP see (M00 §3.4) are dead on a capability offered to
neither, and they mislead the next reader into thinking the model uses it."""

from semestra.core.capability import registry
from semestra.main import create_app

AGENT_ONLY = ("agent_core", "agent_output_fields", "agent_default_fields", "preview", "untrusted")


def test_http_only_capabilities_carry_no_agent_options():
    create_app()
    dead = sorted(
        f"{cap.name}: {option}"
        for cap in registry.list()
        if not {"agent", "mcp"} & set(cap.expose)
        for option in AGENT_ONLY
        if getattr(cap, option)
    )
    assert dead == []
