"""Test namespaces and a fake scope resolver standing in for M02's academic structure."""

from collections.abc import Iterator
from typing import Literal

import pytest
from pydantic import BaseModel, Field

from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.modules.settings import registry
from semestra.modules.settings.registry import (
    ScopeChain,
    ScopeType,
    register_settings,
    set_scope_resolver,
)


class DemoCalendar(BaseModel):
    default_view: Literal["day", "week", "month"] = Field(default="week", description="View")
    show_weekends: bool = Field(default=True, description="Weekends")
    start_hour: int = Field(default=8, ge=0, le=23, description="First hour")


class DemoPlugin(BaseModel):
    focus_min: int = Field(default=25, ge=1, le=180, description="Focus minutes")


register_settings(
    namespace="demo_calendar", schema=DemoCalendar, levels=("account", "program", "term")
)
register_settings(
    namespace="plugin.demo-timer", schema=DemoPlugin, levels=("account",), plugin_id="demo-timer"
)

# program P1 → term T1 → courses C1 (current term T1) and C2 (no current term); P2 → term T2.
# P3/T3/C3 exist but belong to someone else.
CHAINS = {
    ("program", "P1"): ScopeChain("P1"),
    ("program", "P2"): ScopeChain("P2"),
    ("term", "T1"): ScopeChain("P1", "T1"),
    ("term", "T2"): ScopeChain("P2", "T2"),
    ("course", "C1"): ScopeChain("P1", "T1", "C1"),
    ("course", "C2"): ScopeChain("P1", None, "C2"),
}


async def _fake_resolver(ctx: Ctx, scope_type: ScopeType, scope_id: str) -> ScopeChain:
    try:
        return CHAINS[(scope_type, scope_id)]
    except KeyError:
        raise AppError("common.not_found", 404) from None


@pytest.fixture(autouse=True)
def fake_scopes() -> Iterator[None]:
    previous = registry._resolver
    set_scope_resolver(_fake_resolver)
    yield
    set_scope_resolver(previous)
