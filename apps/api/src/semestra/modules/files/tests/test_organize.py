"""Organizing a course's files into type folders when the user asks (M07 §8): the rules where
they tell, the model (which also reads the start of the text) for the rest; nothing moves until
the user applies the plan, a file the user moved meanwhile stays, and the type folders the user
renamed are kept."""

import json
from typing import Any

import pytest
import respx

from semestra.core.capability import registry
from semestra.core.context import Ctx, run_as_system
from semestra.modules.agent.display import make_preview
from semestra.modules.files import sorting
from semestra.modules.files.tests.conftest import Fx, model_sorts, sorting_model


async def _organize(fx: Fx) -> dict[str, Any]:
    await fx.call("POST", f"/courses/{fx.course_id}/files:organize")
    await fx.run_jobs()
    return await fx.call("GET", f"/courses/{fx.course_id}/files:organize")


async def _where(fx: Fx) -> dict[str, str | None]:
    got = await fx.call("GET", f"/courses/{fx.course_id}/files", params={"recursive": True})
    names = {f["id"]: f["name"] for f in got["folders"]}
    return {i["display_name"]: names.get(i["folder_id"]) for i in got["items"]}


async def test_organizing_the_unsorted_files(fx: Fx, monkeypatch: pytest.MonkeyPatch):
    await fx.upload_ready("Lecture 3.txt", b"Pointers and arrays.")
    scan = await fx.upload_ready("scan_0031.txt", b"Final examination, December 2024. Answer all.")
    await fx.upload_ready("IMG_2207.txt", b"A photo of the whiteboard.")
    await fx.upload_ready("Syllabus.txt", b"Grading: labs 20%.")
    mine = await fx.call("POST", f"/courses/{fx.course_id}/folders", json={"name": "Mine"})
    await fx.upload_ready("Lecture 9.txt", b"Already sorted.", folder_id=mine["id"])

    notes = await fx.upload_ready("misc.txt", b"Some jottings.")
    monkeypatch.setattr(sorting, "BATCH", 2)

    with respx.mock(assert_all_called=False) as mock:
        route = await sorting_model(fx.client, mock, monkeypatch)
        # The provider fails: the organizing fails with its error, and nothing waits for review.
        state = await _organize(fx)
        assert state["plan"] is None
        assert state["job"]["status"] == "failed"
        assert state["job"]["error_code"].startswith("ai.")

        model_sorts(
            route, {"scan_0031.txt": "exams", "IMG_2207.txt": "general", "misc.txt": "lectures"}
        )
        state = await _organize(fx)
        # Only what the rules can't tell goes to the model, with the start of its text, in
        # batches.
        assert route.call_count == 2
        shown = "".join(
            json.loads(c.request.content)["messages"][0]["content"][0]["text"] for c in route.calls
        )
        assert "Final examination, December 2024" in shown
        assert "Lecture 3.txt" not in shown
        pending = await fx.call("GET", f"/programs/{fx.program_id}/file-organizations")
        assert pending == {"items": [{"course_id": fx.course_id, "job": None, "count": 3}]}

        # The user files the notes themselves before reviewing: they are no longer in the plan.
        await fx.call("PATCH", f"/files/{notes['id']}", json={"folder_id": mine["id"]})
        plan = (await fx.call("GET", f"/courses/{fx.course_id}/files:organize"))["plan"]
        moves = {m["item_id"]: m for m in plan["moves"]}
        assert sorted((m["type"], m["folder_id"], m["folder_name"]) for m in moves.values()) == [
            ("exams", None, "Past exams"),
            ("lectures", None, "Lectures"),
        ]
        assert plan["left"] == 2  # the photo, the syllabus
        assert notes["id"] not in moves
        assert (await _where(fx))["Lecture 3.txt"] is None  # nothing moved yet

        # The user keeps only the scan.
        applied = await fx.call(
            "POST",
            f"/courses/{fx.course_id}/files:organize-apply",
            json={"item_ids": [scan["id"], notes["id"]]},
        )
        assert applied == {"moved": 1}
        # Done with: nothing waits any more.
        assert await fx.call("GET", f"/courses/{fx.course_id}/files:organize") == {
            "job": None,
            "plan": None,
        }
        where = await _where(fx)
        assert (where["scan_0031.txt"], where["Lecture 3.txt"], where["misc.txt"]) == (
            "Past exams",
            None,
            "Mine",
        )

        # A type folder the user renames stays that type's: the next plan uses it.
        folders = await fx.call("GET", f"/courses/{fx.course_id}/files", params={"recursive": True})
        exams = next(f for f in folders["folders"] if f["name"] == "Past exams")
        await fx.call("PATCH", f"/folders/{exams['id']}", json={"name": "Old tests"})
        await fx.upload_ready("Midterm 2023.txt", b"Midterm.")
        plan = (await _organize(fx))["plan"]
        assert [(m["type"], m["folder_id"], m["folder_name"]) for m in plan["moves"]] == [
            ("lectures", None, "Lectures"),
            ("exams", exams["id"], "Old tests"),
        ]


async def test_sem_shows_where_each_file_goes_before_moving_it(fx: Fx):
    """Sem applies a plan through a confirmation card that names each file's folder."""
    await fx.upload_ready("Lecture 3.txt", b"Pointers and arrays.")
    await fx.upload_ready("Lecture 4.txt", b"Structs.")
    await fx.upload_ready("Midterm 2023.txt", b"Midterm.")
    plan = (await _organize(fx))["plan"]
    args = {"course_id": fx.course_id, "item_ids": [m["item_id"] for m in plan["moves"]]}
    card: dict[str, Any] = {}

    async def preview(ctx: Ctx) -> None:
        card.update(await make_preview(ctx, registry.get("files.organization.apply"), args))

    await run_as_system(fx.app.state, fx.user.id, preview)
    shown = {c["label"]: (sorted(c["after"]), c["count"]) for c in card["changes"]}
    assert shown == {
        "Lectures": (["Lecture 3.txt", "Lecture 4.txt"], 2),
        "Past exams": (["Midterm 2023.txt"], 1),
    }
    assert card["link"]["to"].endswith(f"/c/{fx.course_id}/files")
    assert (await _where(fx))["Lecture 3.txt"] is None  # the card moved nothing

    # Starting again would drop the plan waiting for review: the card says which files it has.
    card.clear()

    async def restart(ctx: Ctx) -> None:
        start = registry.get("files.organization.start")
        card.update(await make_preview(ctx, start, {"course_id": fx.course_id}))

    await run_as_system(fx.app.state, fx.user.id, restart)
    [pending] = card["changes"]
    assert (pending["field"], pending["after"], pending["count"]) == ("pending_plan", None, 3)
    assert sorted(pending["before"]) == ["Lecture 3.txt", "Lecture 4.txt", "Midterm 2023.txt"]
