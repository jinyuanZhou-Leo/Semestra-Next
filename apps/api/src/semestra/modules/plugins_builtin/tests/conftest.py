"""Stand-in for M10's card instances in plugin tests: `cards.add('habit.ring', ...)`."""

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

    async def list_card_instances(
        ctx: Ctx, *, card_id: str, scope_type: str, scope_id: str
    ) -> list[instances.CardInstance]:
        return [
            i
            for k, i in fake.items.items()
            if fake.owners[k] == ctx.user_id
            and (i.card_id, i.scope_type, i.scope_id) == (card_id, scope_type, scope_id)
        ]

    async def update_card_settings(ctx: Ctx, instance_id: str, patch: dict[str, Any]) -> None:
        found = fake.items[instance_id]
        fake.items[instance_id] = instances.CardInstance(
            found.instance_id,
            found.card_id,
            found.scope_type,
            found.scope_id,
            {**found.settings, **patch},
        )

    monkeypatch.setattr(instances, "get_card_instance", get_card_instance)
    monkeypatch.setattr(instances, "list_card_instances", list_card_instances)
    monkeypatch.setattr(instances, "update_card_settings", update_card_settings)
    return fake
