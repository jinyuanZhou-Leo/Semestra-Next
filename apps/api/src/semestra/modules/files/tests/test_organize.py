"""Organizing a course's files into type folders when the user asks (M07 §8): the rules where
they tell, the model (which also reads the start of the text) for the rest; nothing moves until
the user applies the plan, and the type folders the user renamed are kept."""

import json
from typing import Any

import pytest
import respx

from semestra.modules.files.tests.conftest import Fx, model_sorts, sorting_model


async def _organize(fx: Fx) -> dict[str, Any]:
    job = await fx.call("POST", f"/courses/{fx.course_id}/files:organize", json={})
    await fx.run_jobs()
    return await fx.call("GET", f"/courses/{fx.course_id}/files:organize/{job['id']}")


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

    with respx.mock(assert_all_called=False) as mock:
        route = await sorting_model(fx.client, mock, monkeypatch)
        model_sorts(route, {"scan_0031.txt": "exams", "IMG_2207.txt": "general"})
        plan = await _organize(fx)
        # Only what the rules can't tell goes to the model, with the start of its text.
        [request] = route.calls
        shown = json.loads(request.request.content)["messages"][0]["content"][0]["text"]
        assert "Final examination, December 2024" in shown
        assert "Lecture 3.txt" not in shown

    moves = {m["item_id"]: m for m in plan["moves"]}
    assert sorted((m["type"], m["folder_id"], m["folder_name"]) for m in moves.values()) == [
        ("exams", None, "Past exams"),
        ("lectures", None, "Lectures"),
    ]
    assert plan["left"] == 2  # the photo, the syllabus
    assert (await _where(fx))["Lecture 3.txt"] is None  # nothing moved yet

    # The user keeps only the scan.
    applied = await fx.call(
        "POST",
        f"/courses/{fx.course_id}/files:organize-apply",
        json={"moves": [{"item_id": scan["id"], "type": "exams"}]},
    )
    assert applied == {"moved": 1}
    where = await _where(fx)
    assert (where["scan_0031.txt"], where["Lecture 3.txt"], where["Lecture 9.txt"]) == (
        "Past exams",
        None,
        "Mine",
    )

    # A type folder the user renames stays that type's: the next plan uses it, without a model.
    folders = await fx.call("GET", f"/courses/{fx.course_id}/files", params={"recursive": True})
    exams = next(f for f in folders["folders"] if f["name"] == "Past exams")
    await fx.call("PATCH", f"/folders/{exams['id']}", json={"name": "Old tests"})
    await fx.upload_ready("Midterm 2023.txt", b"Midterm.")
    plan = await _organize(fx)
    assert [(m["type"], m["folder_id"], m["folder_name"]) for m in plan["moves"]] == [
        ("lectures", None, "Lectures"),
        ("exams", exams["id"], "Old tests"),
    ]
