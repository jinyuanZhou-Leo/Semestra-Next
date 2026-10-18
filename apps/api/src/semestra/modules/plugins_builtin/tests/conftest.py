"""Stand-in for M10's card instances in plugin tests: `cards.add('habit.board', ...)`."""

from dataclasses import dataclass, field
from typing import Any

import pytest

from semestra.core.context import Ctx
from semestra.modules.plugins_builtin import instances


@dataclass
class FakeCards:
    items: dict[str, instances.CardInstance] = field(default_factory=lambda: {})
    owners: dict[str, str] = field(default_factory=lambda: {})
    _next: int = 0

    def add(
        self,
        user_id: str,
        card_id: str,
        scope_type: str,
        scope_id: str,
        settings: dict[str, Any] | None = None,
    ) -> str:
        self._next += 1
        instance_id = f"inst-{self._next}"
        self.items[instance_id] = instances.CardInstance(
            instance_id, card_id, scope_type, scope_id, settings or {}
        )
        self.owners[instance_id] = user_id
        return instance_id


@pytest.fixture
def cards(monkeypatch: pytest.MonkeyPatch) -> FakeCards:
    fake = FakeCards()

    async def get_card_instance(
        ctx: Ctx, instance_id: str, *, card_ids: tuple[str, ...]
    ) -> instances.CardInstance:
        from semestra.core.errors import not_found

        found = fake.items.get(instance_id)
        if (
            found is None
            or fake.owners[instance_id] != ctx.user_id
            or found.card_id not in card_ids
        ):
            raise not_found()
        return found

    monkeypatch.setattr(instances, "get_card_instance", get_card_instance)
    return fake
