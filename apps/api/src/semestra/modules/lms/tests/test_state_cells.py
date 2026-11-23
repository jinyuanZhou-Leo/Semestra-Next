"""Every cell tables 4a and 4b allow, reached through the real entry points (the sync and the
user's requests): a flow of `sync_world` actions for each, recording what `materials.enter` and
`assignment_refs.enter` looked up, and the state it left. Cells the tables say cannot happen
are never looked up: `enter` refuses them, which fails the item (and the test, `conftest`) or
the request (a server error, `World.call`)."""

from collections.abc import Callable
from dataclasses import dataclass, field

import pytest
from fastapi import FastAPI
from sqlalchemy import select

from semestra.core.context import system_ctx
from semestra.modules.lms import assignment_refs
from semestra.modules.lms.models import LmsImportedRef, LmsMaterial
from semestra.modules.lms.tests.conftest import Api, FakeProvider
from semestra.modules.lms.tests.sync_world import ACTIONS, World, allowed, recording
from semestra.testing import Clock

pytestmark = pytest.mark.usefixtures("fake")


def _files_closed(w: World) -> None:
    """The course's files area closed: a file is only read on its own (linked to)."""
    w.fake.unlisted_files, w.fake.course_file_list = w.fake.course_file_list, []
    w.fake.files_hidden = True


def _page_lists(w: World) -> None:
    w.fake.page_texts["notes"] = ("Notes", '<p><a href="https://fake/x">x</a></p>')


@dataclass(frozen=True)
class Flow:
    cell: tuple[str, str, str]  # (table, state, event)
    actions: tuple[str, ...]
    # What it leaves: the material's state (4a: (kind, id) -> state) or the ref's (4b).
    then: str
    of: tuple[str, str] = ("file", "f1")
    before: Callable[[World], None] | None = field(default=None, compare=False)


IMPORT = ("import_opened", "import_committed")
GONE = (*IMPORT, "assignment_deleted")
PAGE = ("page", "notes")

FLOWS = [
    # 4a: the materials.
    Flow(("4a", "None", "appeared"), (), "synced"),
    Flow(("4a", "None", "list"), (), "list", PAGE, before=_page_lists),
    Flow(("4a", "None", "saved"), ("file_saved",), "synced", before=_files_closed),
    Flow(("4a", "synced", "appeared"), ("file_changed",), "synced"),
    Flow(("4a", "synced", "list"), ("page_becomes_list",), "list", PAGE),
    Flow(("4a", "synced", "gone"), ("materials_deleted",), "absent"),
    Flow(("4a", "synced", "deleted"), ("material_items_deleted",), "dismissed"),
    Flow(("4a", "synced", "saved"), ("file_saved",), "synced"),
    Flow(("4a", "synced", "released"), ("materials_off_and_removed",), "absent"),
    Flow(
        ("4a", "synced", "removed"),
        ("areas_closed", "items_refused", "days_passed", "unreadable_removed"),
        "dismissed",
    ),
    Flow(("4a", "synced", "unlinked"), ("unlinked",), "gone"),
    Flow(("4a", "list", "appeared"), ("page_becomes_list", "page_becomes_list"), "synced", PAGE),
    Flow(("4a", "list", "list"), ("page_becomes_list", "file_changed"), "list", PAGE),
    # A page read on its own is taken as there for a day (table 3c, row 7): `days_passed`.
    Flow(
        ("4a", "list", "gone"),
        ("page_becomes_list", "days_passed", "materials_deleted"),
        "absent",
        PAGE,
    ),
    Flow(("4a", "dismissed", "appeared"), ("material_items_deleted", "file_changed"), "dismissed"),
    Flow(
        ("4a", "dismissed", "list"),
        ("material_items_deleted", "page_becomes_list"),
        "dismissed",
        PAGE,
    ),
    Flow(("4a", "dismissed", "saved"), ("material_items_deleted", "file_saved"), "synced"),
    Flow(
        ("4a", "dismissed", "restored"), ("material_items_deleted", "material_restored"), "synced"
    ),
    Flow(("4a", "absent", "appeared"), ("materials_deleted", "materials_back"), "synced"),
    Flow(
        ("4a", "absent", "list"),
        ("materials_deleted", "days_passed", "page_becomes_list", "materials_back"),
        "list",
        PAGE,
    ),
    Flow(
        ("4a", "absent", "gone"),
        ("material_items_deleted", "materials_deleted", "material_restored"),
        "absent",
    ),
    Flow(("4a", "absent", "saved"), ("materials_off_and_removed", "file_saved"), "synced"),
    # 4b: the assignment and its Semestra object.
    Flow(("4b", "None", "import"), IMPORT, "imported"),
    Flow(("4b", "None", "ignore"), ("ignored",), "ignored"),
    Flow(("4b", "ignored", "import"), ("ignored", *IMPORT), "imported"),
    Flow(("4b", "ignored", "remind"), ("ignored", "reminded"), "None"),
    Flow(("4b", "ignored", "gone"), ("ignored", "assignment_deleted"), "None"),
    Flow(("4b", "ignored", "back"), ("ignored", "assignment_changed"), "ignored"),
    Flow(("4b", "ignored", "unlink"), ("ignored", "unlinked"), "None"),
    Flow(
        ("4b", "imported", "move"),
        ("import_opened_as_task", "import_committed", "added_to_gradebook", "import_committed"),
        "imported",
    ),
    Flow(("4b", "imported", "gone"), GONE, "removed"),
    Flow(("4b", "imported", "back"), (*IMPORT, "assignment_changed"), "imported"),
    Flow(("4b", "imported", "detach"), (*IMPORT, "unbound"), "None"),
    Flow(("4b", "imported", "unlink"), (*IMPORT, "unlinked"), "None"),
    Flow(("4b", "removed", "gone"), (*GONE, "file_changed"), "removed"),
    Flow(("4b", "removed", "back"), (*GONE, "assignment_back"), "imported"),
    Flow(("4b", "removed", "keep"), (*GONE, "removed_kept"), "None"),
    Flow(("4b", "removed", "delete"), (*GONE, "removed_deleted"), "None"),
    Flow(("4b", "removed", "detach"), (*GONE, "object_deleted"), "None"),
    Flow(("4b", "removed", "unlink"), (*GONE, "unlinked"), "None"),
]


def test_every_allowed_cell_has_a_flow():
    assert {f.cell for f in FLOWS} == allowed("4a") | allowed("4b")
    assert all(a in ACTIONS for f in FLOWS for a in f.actions)


@pytest.mark.parametrize("flow", FLOWS, ids=lambda f: "-".join(f.cell))
async def test_cell(
    api: Api,
    app: FastAPI,
    fake: FakeProvider,
    clock: Clock,
    monkeypatch: pytest.MonkeyPatch,
    flow: Flow,
):
    world = World(api, app, fake, clock)
    with recording(monkeypatch) as cells:
        await world.setup(flow.before)
        for name in flow.actions:
            await world.step(name)
    assert cells[flow.cell], f"{flow.cell} not reached: {sorted(cells)}"
    assert set(cells) <= allowed("4a") | allowed("4b")
    async with system_ctx(app.state, world.user_id) as ctx:
        if flow.cell[0] == "4a":
            mat = await ctx.db.scalar(
                select(LmsMaterial).where(
                    LmsMaterial.kind == flow.of[0], LmsMaterial.external_id == flow.of[1]
                )
            )
            assert (mat.state if mat is not None else "gone") == flow.then
        else:
            ref = await ctx.db.scalar(
                select(LmsImportedRef).where(LmsImportedRef.external_id == "a1")
            )
            assert str(assignment_refs.state_of(ref)) == flow.then
