"""The plugin template works end to end (M14 §6): settings, capabilities, agent tools."""

from collections.abc import Awaitable, Callable

import pytest
from httpx import AsyncClient

import semestra.modules.plugins_builtin._template  # noqa: F401  (registers for this session)
from semestra.core.capability import registry
from semestra.modules.plugins_builtin.tests.conftest import FakeCards
from semestra.testing import MakeUser, UserHandle

LoginAs = Callable[[AsyncClient, UserHandle], Awaitable[str]]


@pytest.fixture
async def user(client: AsyncClient, make_user: MakeUser, login_as: LoginAs) -> UserHandle:
    user = await make_user()
    await login_as(client, user)
    return user


async def test_read_and_append(client: AsyncClient, user: UserHandle, cards: FakeCards) -> None:
    note = cards.add(user.id, "hello.note", "course", "c1")
    r = await client.get(f"/hello/notes/{note}")
    assert r.json() == {"instance_id": note, "text": "", "lines": 0}

    await client.post(f"/hello/notes/{note}/lines", json={"line": "first"})
    r = await client.post(f"/hello/notes/{note}/lines", json={"line": "second"})
    assert r.status_code == 200, r.text
    assert r.json()["text"] == "first\nsecond"
    assert r.json()["lines"] == 2


async def test_errors_carry_a_code_and_params(
    client: AsyncClient, user: UserHandle, cards: FakeCards
) -> None:
    note = cards.add(user.id, "hello.note", "course", "c1", {"text": "x" * 1990})
    r = await client.post(f"/hello/notes/{note}/lines", json={"line": "y" * 20})
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "hello_note.too_long"
    assert r.json()["error"]["params"] == {"limit": 2000}

    other = cards.add(user.id, "habit.ring", "course", "c1")
    assert (await client.get(f"/hello/notes/{other}")).status_code == 404


def test_the_tools_belong_to_the_plugin() -> None:
    for name in ("hello.note.get", "hello.note.append"):
        assert registry.get(name).plugin_id == "hello-note"
