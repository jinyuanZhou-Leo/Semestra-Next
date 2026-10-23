"""Import uploads and the storage quota, retention, and commits that race each other."""

from datetime import timedelta
from typing import Any

import pytest
from fastapi import FastAPI
from sqlalchemy import update
from sqlalchemy.orm.attributes import set_committed_value

from semestra.core.context import system_ctx
from semestra.core.errors import AppError
from semestra.core.storage import usage
from semestra.modules.imports import service
from semestra.modules.imports.models import ImportsSession
from semestra.modules.imports.schemas import CommitInput
from semestra.modules.imports.tests.test_imports import Api, by_type
from semestra.modules.imports.tests.test_imports_rules import ACORN


async def _used(app: FastAPI, api: Api) -> int:
    me = await api.call("GET", "/account/me")
    async with system_ctx(app.state, me["id"]) as ctx:
        return (await usage(ctx)).used_bytes


async def test_import_uploads_count_against_the_quota(app: FastAPI, api: Api):
    app.state.settings.user_storage_quota_bytes = await _used(app, api) + 100
    err = await api.call(
        "POST", "/imports/uploads", 413, files={"file": ("big.txt", b"x" * 200, "text/plain")}
    )
    assert err["error"]["code"] == "common.quota_exceeded"
    await api.upload("small.txt", b"x" * 60, "text/plain")
    err = await api.call(
        "POST", "/imports/uploads", 413, files={"file": ("more.txt", b"x" * 60, "text/plain")}
    )
    assert err["error"]["code"] == "common.quota_exceeded"


async def test_upload_body_over_the_limit_is_refused_before_parsing(app: FastAPI, api: Api):
    app.state.settings.files_max_upload_bytes = 1000
    body = b"x" * (200 * 1024)
    err = await api.call(
        "POST", "/imports/uploads", 413, files={"file": ("big.txt", body, "text/plain")}
    )
    assert err["error"]["code"] == "files.too_large"


async def test_sessions_left_for_later_are_cleaned_up(app: FastAPI, api: Api):
    program_id = await api.program()
    term_id = await api.term(program_id)
    upload = await api.upload("acorn.ics", ACORN, "text/calendar")
    session = await api.create(
        program_id, source_kind="ics", target={"kind": "term", "term_id": term_id},
        upload_ids=[upload],
    )  # fmt: skip
    assert session["status"] == "ready"
    async with system_ctx(app.state) as ctx:
        await ctx.db.execute(
            update(ImportsSession)
            .where(ImportsSession.id == session["id"])
            .values(updated_at=ctx.now - timedelta(days=31))
        )
        await ctx.db.commit()
    async with system_ctx(app.state) as ctx:
        await service.cleanup(ctx)
        await ctx.db.commit()
        for fn in ctx.after_commit:
            await fn()
    await api.call("GET", f"/imports/{session['id']}", 404)
    assert (await api.client.get(f"/imports/uploads/{upload}/content")).status_code == 404


async def test_a_commit_that_lost_the_race_writes_nothing(app: FastAPI, api: Api):
    program_id = await api.program()
    term_id = await api.term(program_id)
    upload = await api.upload("acorn.ics", ACORN, "text/calendar")
    session = await api.create(
        program_id, source_kind="ics", target={"kind": "term", "term_id": term_id},
        upload_ids=[upload],
    )  # fmt: skip
    me = await api.call("GET", "/account/me")
    async with system_ctx(app.state, me["id"]) as late:
        # This request read the session before the other one committed it.
        row = await service.get_session_row(late, session["id"])
        seen = (row.status, row.updated_at)
        done = await api.commit(session["id"])
        assert done["created"] == 8
        set_committed_value(row, "status", seen[0])
        set_committed_value(row, "updated_at", seen[1])
        with pytest.raises(AppError) as err:
            await service.commit(late, CommitInput(session_id=session["id"]))
        assert err.value.code == "import.session_closed"
    courses = await api.call("GET", f"/programs/{program_id}/courses")
    assert len(courses["items"]) == 2


async def test_syllabus_is_filed_when_the_quota_fits_it_once(
    app: FastAPI, api: Api, fake_ai: list[dict[str, Any]], run_jobs
):
    from semestra.modules.files.tests.conftest import make_pdf

    program_id = await api.program()
    term_id = await api.term(program_id)
    course = await api.course(program_id, term_id)
    pdf = make_pdf(["APS105 Computer Fundamentals", "Drop deadline: March 9"])
    upload = await api.upload("syllabus.pdf", pdf, "application/pdf")
    # Room for the file once more, not twice: moving it must not count it twice.
    app.state.settings.user_storage_quota_bytes = await _used(app, api) + len(pdf) // 2
    session = await api.create(
        program_id, source_kind="syllabus",
        target={"kind": "course", "course_id": course["id"], "term_id": term_id},
        upload_ids=[upload],
    )  # fmt: skip
    await run_jobs()
    session = await api.call("GET", f"/imports/{session['id']}")
    (task,) = by_type(session, "task")
    done = await api.commit(session["id"], item_ids=[task["id"]])
    assert done["session"]["source_refs"][0].get("warning_code") is None
    files = await api.call("GET", f"/courses/{course['id']}/files")
    assert [i["display_name"] for i in files["items"]] == ["syllabus.pdf"]


async def test_syllabus_not_filed_is_reported(
    app: FastAPI, api: Api, fake_ai: list[dict[str, Any]], run_jobs
):
    from semestra.modules.files.tests.conftest import make_pdf

    program_id = await api.program()
    term_id = await api.term(program_id)
    course = await api.course(program_id, term_id)
    upload = await api.upload("syllabus.pdf", make_pdf(["APS105"]), "application/pdf")
    session = await api.create(
        program_id, source_kind="syllabus",
        target={"kind": "course", "course_id": course["id"], "term_id": term_id},
        upload_ids=[upload],
    )  # fmt: skip
    await run_jobs()
    session = await api.call("GET", f"/imports/{session['id']}")
    (task,) = by_type(session, "task")
    app.state.settings.files_max_upload_bytes = 10  # the course files refuse it
    done = await api.commit(session["id"], item_ids=[task["id"]])
    assert done["failed"] == 0
    assert done["session"]["source_refs"][0]["warning_code"] == "import.upload_not_filed"
    # The upload stays with the session (its "show source" still works).
    assert (await api.client.get(f"/imports/uploads/{upload}/content")).status_code == 200


async def test_upload_type_comes_from_the_content(app: FastAPI, api: Api):
    from semestra.modules.files.tests.conftest import make_pdf

    pdf = await api.call(
        "POST", "/imports/uploads", files={"file": ("notes.txt", make_pdf(["x"]), "text/plain")}
    )
    assert pdf["mime_type"] == "application/pdf"
    text = await api.call(
        "POST", "/imports/uploads", files={"file": ("s.pdf", b"plain words", "application/pdf")}
    )
    assert text["mime_type"] == "text/plain"


async def test_gbk_text_and_large_photos_are_read_as_the_model_needs(app: FastAPI):
    import io

    from PIL import Image

    from semestra.modules.imports import deps

    settings = app.state.settings
    syllabus = "课程大纲：期中考试占百分之三十，期末考试占百分之四十。"  # noqa: RUF001
    pages, _ = await deps.read_upload(settings, syllabus.encode("gbk"), "a.txt", "text/plain")
    assert pages[0].text == syllabus
    photo = io.BytesIO()
    Image.new("RGB", (4000, 3000), "white").save(photo, "JPEG")
    _, images = await deps.read_upload(settings, photo.getvalue(), "a.jpg", "image/jpeg")
    (image,) = images
    assert image.mime == "image/png"
    assert max(Image.open(io.BytesIO(image.data)).size) <= 2400


async def test_a_commit_sent_while_an_item_was_edited_asks_to_retry(app: FastAPI, api: Api):
    program_id = await api.program()
    term_id = await api.term(program_id)
    upload = await api.upload("acorn.ics", ACORN, "text/calendar")
    session = await api.create(
        program_id, source_kind="ics", target={"kind": "term", "term_id": term_id},
        upload_ids=[upload],
    )  # fmt: skip
    me = await api.call("GET", "/account/me")
    async with system_ctx(app.state, me["id"]) as late:
        row = await service.get_session_row(late, session["id"])
        seen = row.updated_at
        # Another tab edits an item after this request read the session.
        item = session["items"][0]
        await api.call(
            "PATCH", f"/imports/{session['id']}/items/{item['id']}", json={"decision": "reject"}
        )
        set_committed_value(row, "updated_at", seen)
        with pytest.raises(AppError) as err:
            await service.commit(late, CommitInput(session_id=session["id"]))
        assert err.value.code == "import.session_changed"
    done = await api.commit(session["id"])
    assert done["created"] > 0
