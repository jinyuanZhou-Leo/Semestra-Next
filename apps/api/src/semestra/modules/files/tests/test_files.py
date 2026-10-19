"""End-to-end behaviour of the files module over HTTP (M07 §9)."""

from semestra.core.config import Settings
from semestra.modules.files.tests.conftest import (
    SYLLABUS,
    FakeAi,
    Fx,
    LoginAs,
    make_docx,
    make_pdf,
    make_png,
)
from semestra.testing import MakeUser


async def storage_keys(fx: Fx) -> list[str]:
    root = fx.app.state.storage.root
    return sorted(str(p.relative_to(root)) for p in root.rglob("*") if p.is_file())


# --- upload and processing --------------------------------------------------------------------


async def test_upload_is_processed_into_pages_and_chunks(fx: Fx):
    item = await fx.upload("syllabus.pdf", make_pdf(SYLLABUS))
    assert item["kind"] == "file"
    assert item["mime_type"] == "application/pdf"
    assert item["doc_status"] == "pending"
    assert item["job_id"]

    await fx.run_jobs()
    ready = await fx.call("GET", f"/files/{item['id']}")
    assert ready["doc_status"] == "ready"
    assert ready["page_count"] == 3
    assert ready["job_id"] is None

    read = await fx.call("GET", f"/files/{item['id']}/document", params={"page_from": 2})
    assert [p["page_no"] for p in read["pages"]] == [2, 3]
    assert "30 percent" in read["pages"][0]["markdown"]
    assert read["next_page"] is None

    outline = await fx.call("GET", f"/files/{item['id']}/outline")
    titles = [e["title"] for e in outline["entries"]]
    assert titles[:2] == ["APS105 Computer Fundamentals", "Grading"]
    assert outline["entries"][1]["page"] == 2

    thumb = await fx.client.get(f"/files/{item['id']}/pages/1.png")
    assert thumb.status_code == 200
    assert thumb.content.startswith(b"\x89PNG")


async def test_unsupported_files_are_stored_but_not_indexed(fx: Fx):
    item = await fx.upload("archive.bin", b"\x00\x01\x02\x03binary")
    assert item["doc_status"] == "unsupported"
    assert item["job_id"] is None
    await fx.call("GET", f"/files/{item['id']}/document", status=409)


async def test_broken_file_fails_with_a_code_and_can_be_retried(fx: Fx):
    item = await fx.upload("broken.pdf", b"%PDF-1.7 this is not really a pdf")
    await fx.run_jobs()
    failed = await fx.call("GET", f"/files/{item['id']}")
    assert failed["doc_status"] == "failed"
    assert failed["doc_error_code"] == "files.parse_failed"

    again = await fx.call("POST", f"/files/{item['id']}:reprocess")
    assert again["doc_status"] == "pending"
    assert again["doc_error_code"] is None


async def test_reprocess_switches_the_document_atomically(fx: Fx):
    item = await fx.upload_ready("notes.docx", make_docx([("Normal", "Recursion basics")]))
    await fx.call("POST", f"/files/{item['id']}:reprocess")
    # The previous version stays searchable until the new one is ready.
    assert (await fx.search("Recursion"))["results"]
    await fx.run_jobs()
    hits = (await fx.search("Recursion"))["results"]
    assert len(hits) == 1
    assert (await fx.call("GET", f"/files/{item['id']}"))["doc_status"] == "ready"


async def test_scanned_pages_without_vision_are_counted_as_skipped(fx: Fx, fake_ai: FakeAi):
    scanned = make_pdf(["digital page with plenty of real words in it", "scan"], scanned={1})
    item = await fx.upload_ready("scan.pdf", scanned)
    assert item["doc_status"] == "ready"
    assert item["ocr_skipped_pages"] == 1
    assert fake_ai.ocr_calls == 0


async def test_scanned_pages_use_vision_when_available(fx: Fx, fake_ai: FakeAi):
    fake_ai.enabled.add("vision")
    item = await fx.upload_ready("photo.png", make_png())
    assert item["ocr_skipped_pages"] == 0
    assert fake_ai.ocr_calls == 1
    hits = (await fx.search("photosynthesis"))["results"]
    assert hits[0]["item_id"] == item["id"]
    assert hits[0]["heading_path"] == ["Scanned heading"]


# --- listing, folders, links ------------------------------------------------------------------


async def test_folders_links_and_listing(fx: Fx):
    week1 = await fx.call(
        "POST", f"/courses/{fx.course_id}/folders", json={"name": "Week 1", "parent_id": None}
    )
    await fx.call(
        "POST",
        f"/courses/{fx.course_id}/folders",
        json={"name": "Week 1", "parent_id": None},
        status=409,
    )
    slides = await fx.upload("slides.pdf", make_pdf(["Intro"]), folder_id=week1["id"])
    link = await fx.call(
        "POST",
        f"/courses/{fx.course_id}/file-links",
        json={"url": "piazza.com/class/aps105", "display_name": "Piazza"},
    )
    assert link["url"] == "https://piazza.com/class/aps105"
    assert link["doc_status"] == "none"
    await fx.call(
        "POST",
        f"/courses/{fx.course_id}/file-links",
        json={"url": "javascript:alert(1)", "display_name": "x"},
        status=422,
    )

    root = await fx.call("GET", f"/courses/{fx.course_id}/files")
    assert [i["display_name"] for i in root["items"]] == ["Piazza"]
    assert root["folders"][0]["item_count"] == 1
    inside = await fx.call(
        "GET", f"/courses/{fx.course_id}/files", params={"folder_id": week1["id"]}
    )
    assert [i["id"] for i in inside["items"]] == [slides["id"]]
    everything = await fx.call(
        "GET", f"/courses/{fx.course_id}/files", params={"recursive": True, "sort": "name"}
    )
    assert [i["display_name"] for i in everything["items"]] == ["Piazza", "slides.pdf"]

    renamed = await fx.call(
        "PATCH",
        f"/files/{slides['id']}",
        json={"display_name": "Lecture 1.pdf", "folder_id": None, "pinned": True},
    )
    assert renamed["display_name"] == "Lecture 1.pdf"
    assert renamed["folder_id"] is None
    pinned = await fx.call("GET", f"/programs/{fx.program_id}/pinned-files")
    assert [i["id"] for i in pinned["items"]] == [slides["id"]]

    await fx.call("DELETE", f"/folders/{week1['id']}")
    assert (await fx.call("GET", f"/courses/{fx.course_id}/files"))["folders"] == []


async def test_folder_depth_and_non_empty_delete(fx: Fx):
    parent = None
    for depth in range(3):
        folder = await fx.call(
            "POST",
            f"/courses/{fx.course_id}/folders",
            json={"name": f"L{depth}", "parent_id": parent},
        )
        parent = folder["id"]
    too_deep = await fx.call(
        "POST",
        f"/courses/{fx.course_id}/folders",
        json={"name": "L3", "parent_id": parent},
        status=422,
    )
    assert too_deep["error"]["code"] == "files.folder_depth"

    await fx.upload("a.txt", b"hello", folder_id=parent)
    top = (await fx.call("GET", f"/courses/{fx.course_id}/files"))["folders"]
    root_id = next(f["id"] for f in top if f["parent_id"] is None)
    refused = await fx.call("DELETE", f"/folders/{root_id}", status=409)
    assert refused["error"]["code"] == "files.folder_not_empty"
    await fx.call("DELETE", f"/folders/{root_id}", params={"recursive": True})
    left = await fx.call("GET", f"/courses/{fx.course_id}/files", params={"recursive": True})
    assert left == {"folders": [], "items": [], "next_cursor": None}


# --- content download ---------------------------------------------------------------------------


async def test_content_headers_and_ranges(fx: Fx):
    pdf = make_pdf(["hello"])
    item = await fx.upload("Lecture 1 讲义.pdf", pdf)

    r = await fx.client.get(f"/files/{item['id']}/content", params={"disposition": "inline"})
    assert r.status_code == 200
    assert r.content == pdf
    assert r.headers["content-type"] == "application/pdf"
    assert r.headers["content-disposition"].startswith("inline;")
    assert (
        "filename*=UTF-8''Lecture%201%20%E8%AE%B2%E4%B9%89.pdf" in r.headers["content-disposition"]
    )
    assert r.headers["x-content-type-options"] == "nosniff"
    assert "sandbox" in r.headers["content-security-policy"]
    assert r.headers["accept-ranges"] == "bytes"

    part = await fx.client.get(f"/files/{item['id']}/content", headers={"Range": "bytes=0-9"})
    assert part.status_code == 206
    assert part.content == pdf[:10]
    assert part.headers["content-range"] == f"bytes 0-9/{len(pdf)}"
    bad = await fx.client.get(
        f"/files/{item['id']}/content", headers={"Range": f"bytes={len(pdf) + 5}-"}
    )
    assert bad.status_code == 416

    html = await fx.upload("page.html", b"<html><script>alert(1)</script></html>")
    served = await fx.client.get(f"/files/{html['id']}/content", params={"disposition": "inline"})
    assert served.headers["content-disposition"].startswith("attachment;")


# --- search ----------------------------------------------------------------------------------


async def test_keyword_search_finds_codes_and_chinese(fx: Fx):
    item = await fx.upload_ready("syllabus.pdf", make_pdf(SYLLABUS))

    result = await fx.search("midterm percent")
    assert result["mode_used"] == "keyword"
    hit = result["results"][0]
    assert hit["item_id"] == item["id"]
    assert hit["page_from"] == 2
    assert "<mark>midterm</mark>" in hit["snippet"]
    assert hit["citation_id"] == f"{item['id']}:p2-2"

    assert (await fx.search("APS105"))["results"][0]["page_from"] == 1
    chinese = (await fx.search("考试时间"))["results"]
    assert chinese[0]["page_from"] == 3
    assert "<mark>考试时间</mark>" in chinese[0]["snippet"]
    # Two characters is below the trigram size and falls back to a substring scan.
    assert (await fx.search("地点"))["results"][0]["page_from"] == 3
    assert (await fx.search("nothing-like-this"))["results"] == []


async def test_search_scope_and_pending(fx: Fx):
    await fx.upload_ready("a.docx", make_docx([("Normal", "shared keyword alpha")]))
    other = await fx.new_course("Calculus", code="MAT186")
    await fx.upload("b.docx", make_docx([("Normal", "shared keyword beta")]), course_id=other)

    pending = await fx.search("shared keyword")
    assert len(pending["results"]) == 1
    assert [p["display_name"] for p in pending["pending_items"]] == ["b.docx"]

    await fx.run_jobs()
    both = await fx.search("shared keyword")
    assert {h["course_id"] for h in both["results"]} == {fx.course_id, other}
    scoped = await fx.search("shared keyword", course_ids=[other])
    assert {h["course_id"] for h in scoped["results"]} == {other}
    assert (await fx.search("shared keyword", top_k=1))["results"].__len__() == 1


async def test_other_users_files_are_invisible(fx: Fx, make_user: MakeUser, login_as: LoginAs):
    item = await fx.upload_ready("private.docx", make_docx([("Normal", "secret plan")]))
    intruder = await make_user(email="intruder@example.com")
    await login_as(fx.client, intruder)
    for method, url in [
        ("GET", f"/files/{item['id']}"),
        ("GET", f"/files/{item['id']}/content"),
        ("GET", f"/files/{item['id']}/document"),
        ("DELETE", f"/files/{item['id']}"),
        ("GET", f"/courses/{fx.course_id}/files"),
    ]:
        r = await fx.client.request(method, url)
        assert r.status_code == 404, (method, url, r.text)
    await fx.call(
        "POST", f"/programs/{fx.program_id}/files:search", json={"query": "secret"}, status=404
    )


async def test_semantic_and_hybrid_search_with_embeddings(fx: Fx, fake_ai: FakeAi):
    fake_ai.enabled.add("embedding")
    item = await fx.upload_ready("syllabus.pdf", make_pdf(SYLLABUS))
    assert fake_ai.embed_calls

    semantic = await fx.search("grading midterm", mode="semantic")
    assert semantic["mode_used"] == "semantic"
    assert semantic["results"][0]["item_id"] == item["id"]
    hybrid = await fx.search("midterm exam", mode="hybrid")
    assert hybrid["mode_used"] == "hybrid"
    assert hybrid["results"][0]["page_from"] == 2

    fake_ai.enabled.clear()
    fallback = await fx.search("midterm exam", mode="hybrid")
    assert fallback["mode_used"] == "keyword"


async def test_embedding_failure_keeps_keyword_search(fx: Fx, fake_ai: FakeAi):
    fake_ai.enabled.add("embedding")
    fake_ai.fail_embedding = True
    item = await fx.upload_ready("syllabus.pdf", make_pdf(SYLLABUS))
    assert item["doc_status"] == "ready"
    assert (await fx.search("midterm"))["results"]


async def test_changing_embedding_model_reindexes(fx: Fx, fake_ai: FakeAi):
    from semestra.modules.files.vectors import get_vector_store

    fake_ai.enabled.add("embedding")
    await fx.upload_ready("syllabus.pdf", make_pdf(SYLLABUS))
    store = get_vector_store()
    async with fx.app.state.session_factory() as db:
        before = await store.spaces(db)
    assert len(before) == 1

    fake_ai.model = "embed-2"
    from semestra.core.events import Event, events

    await events.dispatch(
        fx.app.state,
        Event("ai.assignment.updated", {"purpose": "embedding"}, fx.user.id),
    )
    await fx.run_jobs()
    async with fx.app.state.session_factory() as db:
        after = await store.spaces(db)
    assert len(after) == 1
    assert after != before
    assert (await fx.search("grading midterm", mode="semantic"))["mode_used"] == "semantic"


# --- quota, delete, cascade ----------------------------------------------------------------------


async def test_quota_and_size_limits_leave_no_orphans(fx: Fx, settings: Settings):
    settings.files_max_upload_bytes = 1000
    too_big = await fx.upload("big.txt", b"x" * 1001, status=413)
    assert too_big["error"]["code"] == "files.too_large"
    assert too_big["error"]["params"]["max"] == 1000

    settings.files_max_upload_bytes = 10_000_000
    settings.user_storage_quota_bytes = 50
    over = await fx.upload("full.txt", b"x" * 60, status=413)
    assert over["error"]["code"] == "common.quota_exceeded"
    assert not [k for k in await storage_keys(fx) if "/files/" in k]
    listing = await fx.call("GET", f"/courses/{fx.course_id}/files")
    assert listing["items"] == []

    usage = await fx.call("GET", "/files-usage")
    assert usage["quota_bytes"] == 50
    assert usage["files_bytes"] == 0


async def test_delete_removes_bytes_index_and_page_images(fx: Fx):
    item = await fx.upload_ready("syllabus.pdf", make_pdf(SYLLABUS))
    assert any(item["id"] in k for k in await storage_keys(fx))
    usage = await fx.call("GET", "/files-usage")
    assert usage["files_bytes"] == item["size_bytes"]

    await fx.call("DELETE", f"/files/{item['id']}")
    assert not any(item["id"] in k for k in await storage_keys(fx))
    assert (await fx.search("midterm"))["results"] == []
    await fx.call("GET", f"/files/{item['id']}", status=404)


async def test_deleting_a_course_purges_its_files(fx: Fx, fake_ai: FakeAi):
    fake_ai.enabled.add("embedding")
    item = await fx.upload_ready("syllabus.pdf", make_pdf(SYLLABUS))
    await fx.call("DELETE", f"/courses/{fx.course_id}")
    assert not any(item["id"] in k for k in await storage_keys(fx))
    await fx.call("GET", f"/files/{item['id']}", status=404)
    from semestra.modules.files.vectors import get_vector_store

    async with fx.app.state.session_factory() as db:
        store = get_vector_store()
        assert all([await store.count(db, s) == 0 for s in await store.spaces(db)])


async def test_agent_capabilities_are_registered():
    from semestra.core.capability import registry

    names = {c.name for c in registry.list()}
    assert {
        "files.list",
        "files.search",
        "files.document.read",
        "files.document.outline",
        "files.link.create",
        "files.folder.create",
    } <= names
