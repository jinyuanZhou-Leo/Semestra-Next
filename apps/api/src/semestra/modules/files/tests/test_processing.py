"""The files being read, as one list for the status bar (M07 §3.1)."""

from semestra.modules.files.tests.conftest import Fx, make_docx


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
    assert (done["active"], done["since"]) == (0, None)
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
    assert listed["active"] == 0
    assert {row["job"]["status"] for row in listed["files"]} == {"cancelled"}
