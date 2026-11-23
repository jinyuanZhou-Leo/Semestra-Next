"""Every sequence of up to `LENGTH` actions on a small course (`sync_world.ACTIONS`: what the
platform and the user can do), each followed by a sync (M09 §11): no server error, no part of
the sync failing, every state in tables 4a and 4b (an event a table does not allow fails the
item, and the test with it), both sides of the materials in agreement, and the part no action
touches still coming in."""

from itertools import product

import pytest
from fastapi import FastAPI

from semestra.modules.lms.tests.conftest import Api, FakeProvider
from semestra.modules.lms.tests.sync_world import ACTIONS, World
from semestra.testing import Clock

pytestmark = pytest.mark.usefixtures("fake")

LENGTH = 2
SEQUENCES = [s for n in range(1, LENGTH + 1) for s in product(ACTIONS, repeat=n)]


@pytest.mark.parametrize("actions", SEQUENCES, ids=lambda s: "+".join(s))
async def test_sequence(
    api: Api, app: FastAPI, fake: FakeProvider, clock: Clock, actions: tuple[str, ...]
):
    world = World(api, app, fake, clock)
    await world.setup()
    for name in actions:
        await world.step(name)
