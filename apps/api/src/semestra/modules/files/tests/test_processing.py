"""The files being read, as one list for the status bar (M07 §3.1)."""

from fastapi import FastAPI

from semestra.core.jobs import LANES
from semestra.modules.files.tests.conftest import Fx, make_docx
from semestra.testing import Clock


async def test_lists_each_file_being_read_with_its_course(fx: Fx):
    other = await fx.new_course("Digital Systems", code="ECE241")
    first = await fx.upload("notes.docx", make_docx([("Normal", "Recursion basics")]))
    second = await fx.upload("lab.docx", make_docx([("Normal", "Flip-flops")]), course_id=other)

    listed = await fx.call("GET", "/me/files/processing")
    assert (listed["active"], listed["done"]) == (2, 0)
    assert listed["since"] is not None
    rows = {row["item_id"]: row for row in listed["files"]}
    assert (rows[first["id"]]["name"], rows[first["id"]]["course_code"]) == ("notes.docx", "APS105")
    assert rows[second["id"]]["course_code"] == "ECE241"
    assert rows[first["id"]]["job"]["status"] == "pending"
    assert not rows[first["id"]]["synced"]
    # Shown by the files line only, not again in the general list of jobs.
    jobs = await fx.call("GET", "/jobs", params={"with_active": True})
    assert all(job["kind"] != "files.process" for job in jobs["items"])

    await fx.run_jobs()
    done = await fx.call("GET", "/me/files/processing")
    assert (done["active"], done["done"]) == (0, 2)
    assert {row["job"]["status"] for row in done["files"]} == {"succeeded"}


async def test_stopping_all_leaves_each_file_unread(fx: Fx):
    first = await fx.upload("notes.docx", make_docx([("Normal", "Recursion basics")]))
    second = await fx.upload("lab.docx", make_docx([("Normal", "Flip-flops")]))

    stopped = await fx.call("POST", "/me/files/processing:cancel")
    assert stopped == {"cancelled": 2}
    for item in (first, second):
        row = await fx.call("GET", f"/files/{item['id']}")
        assert (row["doc_status"], row["doc_error_code"]) == ("failed", "files.cancelled")
    listed = await fx.call("GET", "/me/files/processing")
    assert {row["job"]["status"] for row in listed["files"]} == {"cancelled"}


async def test_counts_the_round_as_files_end(fx: Fx, app: FastAPI, clock: Clock):
    for name in ("a.docx", "b.docx", "c.docx"):
        await fx.upload(name, make_docx([("Normal", name)]))
        clock.advance(seconds=1)
    await app.state.jobs.run_one(LANES)
    listed = await fx.call("GET", "/me/files/processing")
    assert (listed["active"], listed["done"]) == (2, 1)


async def test_lists_each_file_once_and_keeps_failures_until_read_again(fx: Fx, clock: Clock):
    broken = await fx.upload("broken.pdf", b"%PDF-1.4 not really")
    await fx.run_jobs()
    clock.advance(hours=1)
    # A later round that ends well does not push the earlier failure out.
    await fx.upload("notes.docx", make_docx([("Normal", "Recursion basics")]))
    await fx.run_jobs()
    listed = await fx.call("GET", "/me/files/processing")
    rows = {row["item_id"]: row["job"]["status"] for row in listed["files"]}
    assert rows[broken["id"]] == "failed"

    await fx.call("POST", "/me/files/processing:retry", json={"item_ids": [broken["id"]]})
    listed = await fx.call("GET", "/me/files/processing")
    mine = [row for row in listed["files"] if row["item_id"] == broken["id"]]
    assert [row["job"]["status"] for row in mine] == ["pending"]


async def test_files_stopped_together_can_be_read_again_together(fx: Fx):
    first = await fx.upload("notes.docx", make_docx([("Normal", "Recursion basics")]))
    second = await fx.upload("lab.docx", make_docx([("Normal", "Flip-flops")]))
    await fx.call("POST", "/me/files/processing:cancel")
    # The stopped round stays listed, so it can be resumed from the panel.
    listed = await fx.call("GET", "/me/files/processing")
    assert (listed["active"], listed["done"]) == (0, 2)
    ids = [row["item_id"] for row in listed["files"]]
    assert set(ids) == {first["id"], second["id"]}

    retried = await fx.call("POST", "/me/files/processing:retry", json={"item_ids": ids})
    assert retried == {"retried": 2}
    await fx.run_jobs()
    for item in (first, second):
        assert (await fx.call("GET", f"/files/{item['id']}"))["doc_status"] == "ready"
