"""Organizing a course's files when the user asks (M07 §8): the user's own files at the top level
go into the course's folder that fits them, or a new folder for a group of them (the model reads
the start of their text); nothing moves until the user applies the plan, and a file the user
moved meanwhile stays. Moving LMS materials back to their place is in M09's tests."""

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


async def _folder(fx: Fx, name: str, parent: str | None = None) -> dict[str, Any]:
    return await fx.call(
        "POST", f"/courses/{fx.course_id}/folders", json={"name": name, "parent_id": parent}
    )


async def test_organizing_the_loose_files(fx: Fx, monkeypatch: pytest.MonkeyPatch):
    lectures = await _folder(fx, "Lectures")
    labs = await _folder(fx, "Labs")
    lab3 = await _folder(fx, "Lab 3", labs["id"])
    await fx.upload_ready("Lecture 3 notes.txt", b"Pointers and arrays.")
    scan = await fx.upload_ready("scan_0031.txt", b"Lab 3 debugging log: the resistor network.")
    await fx.upload_ready("Piazza digest 1.txt", b"Answers from the forum.")
    await fx.upload_ready("Piazza digest 2.txt", b"More answers from the forum.")
    await fx.upload_ready("todo.txt", b"Buy groceries.")
    await fx.upload_ready("Lecture 9.txt", b"Already filed.", folder_id=lectures["id"])
    monkeypatch.setattr(sorting, "BATCH", 3)

    with respx.mock(assert_all_called=False) as mock:
        route = await sorting_model(fx.client, mock, monkeypatch)
        # The provider fails: the organizing fails with its error, and nothing waits for review.
        state = await _organize(fx)
        assert state["plan"] is None
        assert state["job"]["status"] == "failed"
        assert state["job"]["error_code"].startswith("ai.")

        model_sorts(
            route,
            {
                "Lecture 3 notes.txt": "Lectures",
                "scan_0031.txt": "Labs / Lab 3",
                "Piazza digest 1.txt": "new:Piazza",
                "Piazza digest 2.txt": "new:Piazza",
                # A new folder for one file is not proposed.
                "todo.txt": "new:Errands",
            },
        )
        state = await _organize(fx)
        # Only the loose files go to the model, with the start of their text and the course's
        # folders, in batches.
        assert route.call_count == 2
        shown = "".join(
            json.loads(c.request.content)["messages"][0]["content"][0]["text"] for c in route.calls
        )
        assert "the resistor network" in shown
        assert "Labs / Lab 3" in shown
        assert "Lecture 9.txt" not in shown
        pending = await fx.call("GET", f"/programs/{fx.program_id}/file-organizations")
        assert pending == {"items": [{"course_id": fx.course_id, "job": None, "count": 4}]}

        # The user files the notes themselves before reviewing: they are no longer in the plan.
        notes = next(m for m in state["plan"]["moves"] if m["name"] == "Lecture 3 notes.txt")
        await fx.call("PATCH", f"/files/{notes['item_id']}", json={"folder_id": lab3["id"]})
        plan = (await fx.call("GET", f"/courses/{fx.course_id}/files:organize"))["plan"]
        assert sorted(
            (m["name"], m["folder_id"], m["folder_name"], m["new_folder"]) for m in plan["moves"]
        ) == [
            ("Piazza digest 1.txt", None, "Piazza", True),
            ("Piazza digest 2.txt", None, "Piazza", True),
            ("scan_0031.txt", lab3["id"], "Labs / Lab 3", False),
        ]
        assert plan["left"] == 1  # the to-do list
        assert (await _where(fx))["scan_0031.txt"] is None  # nothing moved yet

        piazza = [m["item_id"] for m in plan["moves"] if m["new_folder"]]
        applied = await fx.call(
            "POST",
            f"/courses/{fx.course_id}/files:organize-apply",
            json={"item_ids": [scan["id"], notes["item_id"], *piazza]},
        )
        assert applied == {"moved": 3}
        # Done with: nothing waits any more.
        assert await fx.call("GET", f"/courses/{fx.course_id}/files:organize") == {
            "job": None,
            "plan": None,
        }
        where = await _where(fx)
        assert where["scan_0031.txt"] == "Lab 3"
        assert where["Lecture 3 notes.txt"] == "Lab 3"  # where the user put it
        assert (where["Piazza digest 1.txt"], where["Piazza digest 2.txt"]) == ("Piazza", "Piazza")
        assert where["todo.txt"] is None


async def test_sem_shows_where_each_file_goes_before_moving_it(
    fx: Fx, monkeypatch: pytest.MonkeyPatch
):
    """Sem applies a plan through a confirmation card that names each file's folder."""
    await _folder(fx, "Lectures")
    await fx.upload_ready("Lecture 3.txt", b"Pointers and arrays.")
    await fx.upload_ready("Lecture 4.txt", b"Structs.")
    await fx.upload_ready("Midterm 2023.txt", b"Midterm.")
    with respx.mock(assert_all_called=False) as mock:
        route = await sorting_model(fx.client, mock, monkeypatch)
        model_sorts(
            route,
            {
                "Lecture 3.txt": "Lectures",
                "Lecture 4.txt": "Lectures",
                "Midterm 2023.txt": "new:Exams",
            },
        )
        plan = (await _organize(fx))["plan"]
    args = {"course_id": fx.course_id, "item_ids": [m["item_id"] for m in plan["moves"]]}
    card: dict[str, Any] = {}

    async def preview(ctx: Ctx) -> None:
        card.update(await make_preview(ctx, registry.get("files.organization.apply"), args))

    await run_as_system(fx.app.state, fx.user.id, preview)
    shown = {c["label"]: (sorted(c["after"]), c["count"]) for c in card["changes"]}
    assert shown == {"Lectures": (["Lecture 3.txt", "Lecture 4.txt"], 2)}
    assert card["link"]["to"].endswith(f"/c/{fx.course_id}/files")
    assert (await _where(fx))["Lecture 3.txt"] is None  # the card moved nothing

    # Starting again would drop the plan waiting for review: the card says which files it has.
    card.clear()

    async def restart(ctx: Ctx) -> None:
        start = registry.get("files.organization.start")
        card.update(await make_preview(ctx, start, {"course_id": fx.course_id}))

    await run_as_system(fx.app.state, fx.user.id, restart)
    [pending] = card["changes"]
    assert (pending["field"], pending["after"], pending["count"]) == ("pending_plan", None, 2)
    assert sorted(pending["before"]) == ["Lecture 3.txt", "Lecture 4.txt"]


async def test_without_a_model_loose_files_stay(fx: Fx):
    await fx.upload_ready("Lecture 3.txt", b"Pointers and arrays.")
    plan = (await _organize(fx))["plan"]
    assert plan == {"moves": [], "left": 1}
