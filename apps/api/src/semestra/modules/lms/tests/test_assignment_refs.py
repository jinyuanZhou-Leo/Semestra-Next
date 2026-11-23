"""One test per cell of M09's table 4b (`assignment_refs.enter`): how an assignment's ref moves
between no row, ignored, imported and removed from the platform, and when the object keeps the
assignment's content (§3.2). Change a cell, change its test."""

from typing import Any

import pytest
from fastapi import FastAPI
from sqlalchemy import delete, func, select

from semestra.core.context import system_ctx
from semestra.modules.lms import assignment_refs
from semestra.modules.lms.assignment_refs import Impossible, RefEvent, RefState
from semestra.modules.lms.models import LmsAssignment, LmsCourseLink, LmsImportedRef
from semestra.modules.lms.tests.conftest import Api
from semestra.modules.lms.tests.test_sync import _assessments, _course

pytestmark = pytest.mark.usefixtures("fake")

IMPOSSIBLE = "impossible"
# The row goes, the object stays with the assignment's content held for it (unbound, unlinked,
# kept). An object deleted takes what was held for it along (`service.forget_targets`).
KEPT = "kept"

# Table 4b as the spec writes it: state -> event -> state after (None: no row).
TABLE: dict[RefState | None, dict[RefEvent, Any]] = {
    None: {
        "import": "imported", "ignore": "ignored", "remind": IMPOSSIBLE, "gone": None,
        "back": None, "keep": IMPOSSIBLE, "delete": IMPOSSIBLE, "detach": IMPOSSIBLE,
        "unlink": None, "move": IMPOSSIBLE,
    },
    "ignored": {
        "import": "imported", "ignore": "ignored", "remind": None, "gone": None,
        "back": "ignored", "keep": IMPOSSIBLE, "delete": IMPOSSIBLE, "detach": IMPOSSIBLE,
        "unlink": None, "move": IMPOSSIBLE,
    },
    "imported": {
        "import": IMPOSSIBLE, "ignore": IMPOSSIBLE, "remind": IMPOSSIBLE, "gone": "removed",
        "back": "imported", "keep": IMPOSSIBLE, "delete": IMPOSSIBLE, "detach": KEPT,
        "unlink": KEPT, "move": "imported",
    },
    "removed": {
        "import": IMPOSSIBLE, "ignore": IMPOSSIBLE, "remind": IMPOSSIBLE, "gone": "removed",
        "back": "imported", "keep": KEPT, "delete": None, "detach": KEPT, "unlink": KEPT,
        "move": IMPOSSIBLE,
    },
}  # fmt: skip
CELLS = [(state, event, after) for state, row in TABLE.items() for event, after in row.items()]


@pytest.mark.parametrize(("state", "event", "after"), CELLS)
async def test_t4b_cell(
    api: Api, app: FastAPI, state: RefState | None, event: RefEvent, after: Any
):
    program_id, course = await _course(api, "a1")
    await api.sync(program_id)  # the assignment is in the mirror
    lab = (await _assessments(api, course))["a1"]
    user_id = (await api.call("GET", "/account/me"))["id"]
    async with system_ctx(app.state, user_id) as ctx:
        link = await ctx.db.scalar(select(LmsCourseLink))
        assert link is not None
        ref = await assignment_refs.ref_of(ctx, link.id, "a1")
        assert ref is not None
        match state:
            case None:
                await ctx.db.execute(delete(LmsImportedRef))
                ref = None
            case "ignored":
                ref.target_kind = ref.target_id = None
                ref.dismissed_at = ctx.now
            case "removed":
                ref.removed_at = ctx.now
            case "imported":
                pass
        await ctx.db.flush()

        async def apply() -> LmsImportedRef | None:
            return await assignment_refs.enter(
                ctx,
                ref,
                event,
                link=link,
                external_id="a1",
                target=("assessment", lab["id"]),
                hold=event in ("detach", "unlink", "keep"),
            )

        if after == IMPOSSIBLE:
            with pytest.raises(Impossible):
                await apply()
            return
        got = assignment_refs.state_of(await apply())
        held = await ctx.db.scalar(
            select(func.count()).where(
                LmsAssignment.held_for_kind == "assessment", LmsAssignment.held_for_id == lab["id"]
            )
        )
        if after == KEPT:
            assert (got, held) == (None, 1)
        else:
            assert (got, held) == (after, 0)
