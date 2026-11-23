"""Longer sequences of the actions of `sync_world` than `test_sync_sequences.py` runs, picked by
Hypothesis, with the same checks after every step (M09 §11)."""

import itertools
from collections.abc import Awaitable, Callable
from datetime import timedelta
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from semestra.modules.lms import sync
from semestra.modules.lms.tests.conftest import Api, FakeProvider
from semestra.modules.lms.tests.sync_world import ACTIONS, World
from semestra.testing import Clock, MakeUser

pytestmark = pytest.mark.usefixtures("fake")

_users = itertools.count()


@settings(
    max_examples=25,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture, HealthCheck.too_slow],
)
@given(actions=st.lists(st.sampled_from(sorted(ACTIONS)), min_size=3, max_size=12))
async def test_walk(
    actions: list[str],
    app: FastAPI,
    client: AsyncClient,
    make_user: MakeUser,
    login_as: Callable[[AsyncClient, Any], Awaitable[str]],
    run_jobs: Callable[[], Awaitable[None]],
    clock: Clock,
    fake: FakeProvider,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(sync, "COOLDOWN", timedelta(0))
    fake.__init__()  # each example starts from the same platform
    user = await make_user(email=f"walk{next(_users)}@example.com")
    client.cookies.clear()  # each example signs in as a user of its own
    await login_as(client, user)
    world = World(Api(client, run_jobs), app, fake, clock)
    await world.setup()
    for name in actions:
        await world.step(name)
