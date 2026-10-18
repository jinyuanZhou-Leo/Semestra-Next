"""Sticky note capabilities (M14 §4): finding and changing a note through the agent tools."""

from collections.abc import Awaitable, Callable

import pytest
from httpx import AsyncClient

from semestra.modules.plugins_builtin.tests.conftest import FakeCards
from semestra.testing import MakeUser, UserHandle

LoginAs = Callable[[AsyncClient, UserHandle], Awaitable[str]]


@pytest.fixture
async def user(client: AsyncClient, make_user: MakeUser, login_as: LoginAs) -> UserHandle:
    user = await make_user()
    await login_as(client, user)
    return user


async def test_list_and_update_a_note(
    client: AsyncClient, user: UserHandle, cards: FakeCards
) -> None:
    a = cards.add(user.id, "sticky.note", "course", "c1", {"content": "old", "color": "subject-3"})
    cards.add(user.id, "sticky.note", "course", "c2", {"content": "elsewhere"})

    r = await client.get("/sticky/notes", params={"scope_type": "course", "scope_id": "c1"})
    assert r.status_code == 200, r.text
    assert r.json()["items"] == [{"instance_id": a, "content": "old", "color": "subject-3"}]

    r = await client.put(f"/sticky/notes/{a}", json={"content": "old\n- midterm: ch. 1-4"})
    assert r.status_code == 200, r.text
    assert r.json()["content"] == "old\n- midterm: ch. 1-4"
    assert cards.items[a].settings["color"] == "subject-3"


async def test_update_refuses_other_cards_and_long_text(
    client: AsyncClient, user: UserHandle, cards: FakeCards
) -> None:
    habit = cards.add(user.id, "habit.ring", "program", "p1")
    note = cards.add(user.id, "sticky.note", "program", "p1")

    r = await client.put(f"/sticky/notes/{habit}", json={"content": "x"})
    assert r.status_code == 404

    r = await client.put(f"/sticky/notes/{note}", json={"content": "x" * 10_001})
    assert r.status_code == 422
