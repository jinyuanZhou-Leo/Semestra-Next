"""M13 §9: round trip, replace and rollback, secrets, legacy backups, account deletion."""

import io
import json
import re
import zipfile
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from typing import Any

import anyio
import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import Table, func, select, text, update

from semestra import __version__
from semestra.core.context import Ctx, system_ctx
from semestra.core.db import Base, new_id
from semestra.core.jobs import CoreJob
from semestra.modules.academics.models import AcademicsProgram, AcademicsTerm
from semestra.modules.ai.models import AiProvider
from semestra.modules.auth.mailer import MemoryMailer
from semestra.modules.auth.models import AuthUser
from semestra.modules.files import service as files_service
from semestra.modules.files.models import FilesItem
from semestra.modules.grading.models import GradingAssessment
from semestra.modules.lms.models import LmsConnection, LmsCourseLink, LmsImportedRef
from semestra.modules.portability import registry
from semestra.modules.portability.registry import Adapter, ImportReport
from semestra.modules.portability.tests.dataset import (
    FEED_TOKEN_HASH,
    LMS_CREDENTIALS,
    SECRET_KEY,
    populate,
)
from semestra.modules.settings.models import SettingsPreferences
from semestra.modules.tasks.models import TasksItem
from semestra.testing import TEST_ORIGIN, Clock, MakeUser, UserHandle

LoginAs = Callable[[AsyncClient, UserHandle], Awaitable[str]]
RunJobs = Callable[[], Awaitable[None]]
_UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
# Tables an account owns that no adapter exports: sign-in data, jobs and this module's own rows,
# all removed with the `auth_users` row.
NOT_ADAPTED = ("auth_", "core_", "portability_")


def _user_tables() -> list[Table]:
    return [
        t
        for t in Base.metadata.sorted_tables
        if "user_id" in t.c and not t.name.startswith(NOT_ADAPTED)
    ]


async def _count(app: FastAPI, table: Table, user_id: str) -> int:
    async with app.state.session_factory() as db:
        return await db.scalar(
            select(func.count()).select_from(table).where(table.c.user_id == user_id)
        )


@asynccontextmanager
async def _client(app: FastAPI) -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app), base_url=TEST_ORIGIN) as c:
        yield c


async def _seed(
    app: FastAPI, user: UserHandle, name: str = "Engineering", *, singletons: bool = True
) -> dict[str, Any]:
    async with app.state.session_factory() as db:
        return await populate(db, user.id, name=name, singletons=singletons)


async def _export(client: AsyncClient, run_jobs: RunJobs, include_files: bool = False) -> bytes:
    started = await client.post("/me/exports", json={"include_files": include_files})
    assert started.status_code == 200, started.text
    assert started.json()["status"] == "pending"
    await run_jobs()
    items = (await client.get("/me/exports")).json()["items"]
    assert items[0]["status"] == "ready"
    download = await client.get(f"/me/exports/{items[0]['id']}/download")
    assert download.status_code == 200
    assert download.headers["content-type"] == "application/zip"
    assert "semestra-backup-" in download.headers["content-disposition"]
    return download.content


async def _upload(client: AsyncClient, body: bytes, name: str = "backup.zip") -> Any:
    return await client.post("/me/imports", files={"file": (name, body, "application/zip")})


def _normalize(archive: bytes) -> dict[str, Any]:
    """Each module's payload with ids, references and timestamps blanked, rows sorted."""
    out: dict[str, Any] = {}
    with zipfile.ZipFile(io.BytesIO(archive)) as z:
        for name in z.namelist():
            if not name.startswith("data/"):
                continue
            payload = json.loads(z.read(name))
            for key, rows in payload.items():
                if not isinstance(rows, list):
                    continue
                cleaned = []
                for row in rows:
                    row = {
                        k: v
                        for k, v in row.items()
                        if k not in ("created_at", "updated_at", "installed_at")
                    }
                    cleaned.append(json.loads(_UUID.sub("<id>", json.dumps(row, sort_keys=True))))
                out[f"{name}:{key}"] = sorted(cleaned, key=lambda r: json.dumps(r, sort_keys=True))
    return out


async def test_every_user_table_has_an_adapter_and_purge_empties_it(
    app: FastAPI, make_user: MakeUser
) -> None:
    user = await make_user()
    other = await make_user(email="other@example.com")
    await _seed(app, user)
    await _seed(app, other)
    covered = {t for a in registry.adapters() for t in a.tables}
    tables = _user_tables()
    missing = [t.name for t in tables if t.name not in covered]
    assert missing == [], f"no portability adapter covers {missing}"
    for table in tables:
        assert await _count(app, table, user.id) > 0, f"the dataset leaves {table.name} empty"

    async with system_ctx(app.state, user.id) as ctx:
        for adapter in reversed(registry.adapters()):
            await adapter.purge(ctx)
        await ctx.db.commit()
    for table in tables:
        assert await _count(app, table, user.id) == 0, table.name
        assert await _count(app, table, other.id) > 0, f"purge touched {table.name} of others"


async def test_round_trip_into_another_account(
    app: FastAPI, client: AsyncClient, make_user: MakeUser, login_as: LoginAs, run_jobs: RunJobs
) -> None:
    alice = await make_user(email="alice@example.com")
    await _seed(app, alice)
    await login_as(client, alice)
    archive = await _export(client, run_jobs)

    with zipfile.ZipFile(io.BytesIO(archive)) as z:
        manifest = json.loads(z.read("manifest.json"))
        blob = b"".join(z.read(n) for n in z.namelist())
    assert manifest["format"] == "semestra-backup"
    assert manifest["version"] == 1
    assert manifest["app_version"] == __version__ != "0.0.0"
    assert manifest["counts"]["academics.programs"] == 1
    assert {"academics", "grading", "schedule", "plugins_builtin"} <= set(manifest["modules"])
    # No secrets in the backup.
    for secret in (SECRET_KEY, FEED_TOKEN_HASH, LMS_CREDENTIALS, "key_hint", "token_hash", "…xyz"):
        assert secret.encode() not in blob

    bob = await make_user(email="bob@example.com")
    async with _client(app) as bob_client:
        await login_as(bob_client, bob)
        uploaded = await _upload(bob_client, archive)
        assert uploaded.status_code == 200, uploaded.text
        preview = uploaded.json()["preview"]
        assert preview["programs"][0]["name"] == "Engineering"
        assert preview["programs"][0]["term_count"] == 1
        assert preview["programs"][0]["course_count"] == 1
        assert preview["counts"]["grading"]["assessments"] == 1
        assert preview["quota_exceeded"] is False

        started = await bob_client.post(
            f"/me/imports/{uploaded.json()['id']}:start",
            json={"mode": "merge", "include_preferences": True},
        )
        assert started.status_code == 200, started.text
        await run_jobs()
        done = (await bob_client.get(f"/me/imports/{uploaded.json()['id']}")).json()
        assert done["status"] == "imported", done
        assert done["report"]["imported"]["academics"]["programs"] == 1
        assert done["report"]["skipped"] == {}

        again = await _export(bob_client, run_jobs)

    before, after = _normalize(archive), _normalize(again)
    # The provider had a key, so it comes back switched off until a key is entered again.
    provider = "data/ai.json:providers"
    assert before[provider][0]["enabled"] is True
    assert before[provider][0]["had_key"] is True
    assert after[provider][0]["enabled"] is False
    assert after[provider][0]["had_key"] is False
    after[provider][0].update(enabled=True, had_key=True)
    assert after == before

    async with app.state.session_factory() as db:
        prefs = await db.get(SettingsPreferences, bob.id)
        program = await db.scalar(
            select(AcademicsProgram).where(AcademicsProgram.user_id == bob.id)
        )
        assert prefs is not None
        assert program is not None
        assert prefs.theme == "dark"
        assert prefs.active_program_id == program.id
        key = await db.scalar(
            select(AiProvider.api_key_encrypted).where(AiProvider.user_id == bob.id)
        )
        assert key is None
        # A task made from an assessment points at the imported assessment.
        assessment = await db.scalar(
            select(GradingAssessment.id).where(GradingAssessment.user_id == bob.id)
        )
        task_ref = await db.scalar(select(TasksItem.source_ref).where(TasksItem.user_id == bob.id))
        assert task_ref == assessment
        # The LMS connection comes without its token; the link and import record follow the ids.
        lms = await db.scalar(select(LmsConnection).where(LmsConnection.user_id == bob.id))
        assert lms is not None
        assert lms.credentials_encrypted is None
        assert lms.last_error_code == "lms.credentials_missing"
        course_link = await db.scalar(select(LmsCourseLink).where(LmsCourseLink.user_id == bob.id))
        assert course_link is not None
        assert course_link.program_id == program.id
        ref = await db.scalar(
            select(LmsImportedRef.target_id).where(LmsImportedRef.user_id == bob.id)
        )
        assert ref == assessment


async def test_a_backup_with_the_dropped_course_order_still_imports(
    app: FastAPI, client: AsyncClient, make_user: MakeUser, login_as: LoginAs, run_jobs: RunJobs
) -> None:
    """Backups made before per-term course order was dropped carry `term_course_order`."""
    alice = await make_user(email="alice@example.com")
    await _seed(app, alice)
    await login_as(client, alice)
    source = zipfile.ZipFile(io.BytesIO(await _export(client, run_jobs)))
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        for name in source.namelist():
            data = source.read(name)
            if name == "data/academics.json":
                payload = json.loads(data)
                term, course = payload["terms"][0], payload["courses"][0]
                payload["term_course_order"] = [
                    {"term_id": term["id"], "course_id": course["id"], "position": 0}
                ]
                data = json.dumps(payload).encode()
            z.writestr(name, data)

    bob = await make_user(email="bob@example.com")
    async with _client(app) as bob_client:
        await login_as(bob_client, bob)
        upload_id = (await _upload(bob_client, out.getvalue())).json()["id"]
        started = await bob_client.post(f"/me/imports/{upload_id}:start", json={"mode": "merge"})
        assert started.status_code == 200, started.text
        await run_jobs()
        done = (await bob_client.get(f"/me/imports/{upload_id}")).json()
    assert done["status"] == "imported", done
    assert done["report"]["imported"]["academics"]["courses"] == 1
    assert "term_course_order" not in done["report"]["imported"]["academics"]


async def test_merge_into_the_same_account_renames_and_selects_programs(
    app: FastAPI, client: AsyncClient, make_user: MakeUser, login_as: LoginAs, run_jobs: RunJobs
) -> None:
    user = await make_user()
    await _seed(app, user, "Engineering")
    await _seed(app, user, "Minor", singletons=False)
    await login_as(client, user)
    archive = await _export(client, run_jobs)
    uploaded = (await _upload(client, archive)).json()
    programs = {p["name"]: p["id"] for p in uploaded["preview"]["programs"]}

    started = await client.post(
        f"/me/imports/{uploaded['id']}:start",
        json={"mode": "merge", "program_ids": [programs["Engineering"]]},
    )
    assert started.status_code == 200
    await run_jobs()
    report = (await client.get(f"/me/imports/{uploaded['id']}")).json()["report"]
    # Rows of the Program that was not selected are left out, not reported as skipped.
    assert report["skipped"] == {}
    assert report["imported"]["academics"]["programs"] == 1
    assert report["imported"]["grading"]["assessments"] == 1
    async with app.state.session_factory() as db:
        names = set(
            await db.scalars(
                select(AcademicsProgram.name).where(AcademicsProgram.user_id == user.id)
            )
        )
    assert names == {"Engineering", "Minor", "Engineering (imported)"}


async def test_replace_requires_the_sentence_and_replaces_everything(
    app: FastAPI, client: AsyncClient, make_user: MakeUser, login_as: LoginAs, run_jobs: RunJobs
) -> None:
    source = await make_user(email="source@example.com")
    await _seed(app, source, "From backup")
    async with _client(app) as source_client:
        await login_as(source_client, source)
        archive = await _export(source_client, run_jobs)

    user = await make_user()
    await _seed(app, user, "Old")
    await login_as(client, user)
    upload_id = (await _upload(client, archive)).json()["id"]

    wrong = await client.post(
        f"/me/imports/{upload_id}:start", json={"mode": "replace", "confirmation": "yes"}
    )
    assert wrong.json()["error"]["code"] == "portability.confirmation_mismatch"

    ok = await client.post(
        f"/me/imports/{upload_id}:start",
        json={"mode": "replace", "confirmation": " Replace my data "},
    )
    assert ok.status_code == 200, ok.text
    await run_jobs()
    async with app.state.session_factory() as db:
        names = list(
            await db.scalars(
                select(AcademicsProgram.name).where(AcademicsProgram.user_id == user.id)
            )
        )
        prefs = await db.get(SettingsPreferences, user.id)
        providers = (
            await db.scalars(select(AiProvider).where(AiProvider.user_id == user.id))
        ).all()
    assert names == ["From backup"]
    # Preferences were not imported, so the account's own stay (with its AI key).
    assert prefs is not None
    assert prefs.theme == "dark"
    assert [p.api_key_encrypted for p in providers] == [SECRET_KEY]


async def test_a_failed_replace_rolls_back_everything(
    app: FastAPI, client: AsyncClient, make_user: MakeUser, login_as: LoginAs, run_jobs: RunJobs
) -> None:
    user = await make_user()
    await _seed(app, user, "Kept")
    await login_as(client, user)
    archive = await _export(client, run_jobs)

    # Break the backup: a term that ends before it starts violates a constraint on write,
    # after the replace has already purged the account.
    source = zipfile.ZipFile(io.BytesIO(archive))
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        for name in source.namelist():
            data = source.read(name)
            if name == "data/academics.json":
                payload = json.loads(data)
                payload["terms"][0]["end_date"] = "2000-01-01"
                data = json.dumps(payload).encode()
            z.writestr(name, data)
    upload_id = (await _upload(client, out.getvalue())).json()["id"]
    started = await client.post(
        f"/me/imports/{upload_id}:start",
        json={"mode": "replace", "confirmation": "替换我的数据"},
    )
    assert started.status_code == 200
    await run_jobs()

    done = (await client.get(f"/me/imports/{upload_id}")).json()
    assert done["status"] == "failed"
    assert done["error_code"] == "portability.invalid_archive"
    async with app.state.session_factory() as db:
        names = list(
            await db.scalars(
                select(AcademicsProgram.name).where(AcademicsProgram.user_id == user.id)
            )
        )
    assert names == ["Kept"]
    for table in _user_tables():
        assert await _count(app, table, user.id) > 0, table.name

    # The upload is kept, so the import can be started again (or discarded).
    discarded = await client.delete(f"/me/imports/{upload_id}")
    assert discarded.status_code == 200
    assert (await client.get(f"/me/imports/{upload_id}")).status_code == 404


async def test_a_file_stored_before_a_later_failure_is_removed(
    app: FastAPI,
    client: AsyncClient,
    make_user: MakeUser,
    login_as: LoginAs,
    run_jobs: RunJobs,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stored: list[str] = []

    async def export(ctx: Ctx, writer: Any) -> None:
        async def chunks() -> AsyncIterator[bytes]:
            yield b"file body"

        writer.write_json({"schema_version": 1})
        await writer.add_file("note-1", chunks())

    async def import_files(ctx: Ctx, payload: Any, id_map: Any, options: Any) -> ImportReport:
        key = f"users/{ctx.user_id}/aa/note-1"
        await options.files.store("note-1", key, "text/plain")
        stored.append(key)
        assert await app.state.storage.exists(key)
        return ImportReport({"notes": 1})

    async def import_fails(ctx: Ctx, payload: Any, id_map: Any, options: Any) -> ImportReport:
        raise ValueError("broken row")

    async def export_json(ctx: Ctx, writer: Any) -> None:
        writer.write_json({"schema_version": 1})

    async def preview(payload: Any) -> dict[str, int]:
        return {}

    async def nothing(ctx: Ctx) -> None:
        return None

    async def nothing_content(ctx: Ctx, preferences: bool) -> None:
        return None

    first = Adapter("aa_files", 1, (), export, import_files, preview, nothing, nothing_content, ())
    second = Adapter(
        "ab_broken",
        1,
        ("aa_files",),
        export_json,
        import_fails,
        preview,
        nothing,
        nothing_content,
        (),
    )
    monkeypatch.setitem(registry._adapters, "aa_files", first)  # pyright: ignore[reportPrivateUsage]
    monkeypatch.setitem(registry._adapters, "ab_broken", second)  # pyright: ignore[reportPrivateUsage]
    user = await make_user()
    await login_as(client, user)
    archive = await _export(client, run_jobs, include_files=True)
    upload_id = (await _upload(client, archive)).json()["id"]
    await client.post(f"/me/imports/{upload_id}:start", json={"mode": "merge"})
    await run_jobs()

    done = (await client.get(f"/me/imports/{upload_id}")).json()
    assert done["status"] == "failed"
    assert stored
    for key in stored:
        assert not await app.state.storage.exists(key)


async def test_files_travel_in_the_archive_only_when_asked(
    app: FastAPI,
    client: AsyncClient,
    make_user: MakeUser,
    login_as: LoginAs,
    run_jobs: RunJobs,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def export(ctx: Ctx, writer: Any) -> None:
        async def chunks() -> AsyncIterator[bytes]:
            yield b"file body"

        writer.write_json({"schema_version": 1})
        await writer.add_file("note-1", chunks())

    async def preview(payload: Any) -> dict[str, int]:
        return {}

    async def nothing(ctx: Ctx) -> None:
        return None

    async def nothing_content(ctx: Ctx, preferences: bool) -> None:
        return None

    async def import_(ctx: Ctx, payload: Any, id_map: Any, options: Any) -> ImportReport:
        return ImportReport()

    adapter = Adapter("zz_files", 1, (), export, import_, preview, nothing, nothing_content, ())
    monkeypatch.setitem(registry._adapters, "zz_files", adapter)  # pyright: ignore[reportPrivateUsage]
    user = await make_user()
    await login_as(client, user)
    without = zipfile.ZipFile(io.BytesIO(await _export(client, run_jobs)))
    with_files = zipfile.ZipFile(io.BytesIO(await _export(client, run_jobs, include_files=True)))
    assert [n for n in without.namelist() if n.startswith("files/")] == []
    assert with_files.read("files/note-1") == b"file body"
    assert json.loads(with_files.read("manifest.json"))["include_files"] is True


async def test_course_files_travel_with_their_contents(
    app: FastAPI, client: AsyncClient, make_user: MakeUser, login_as: LoginAs, run_jobs: RunJobs
) -> None:
    alice = await make_user(email="alice@example.com")
    ids = await _seed(app, alice)
    item_id = new_id()
    key = files_service.storage_key(alice.id, item_id)
    await app.state.storage.put(key, _one(b"week 1 notes"), "text/plain")
    async with app.state.session_factory() as db:
        db.add(
            FilesItem(
                id=item_id,
                user_id=alice.id,
                course_id=ids["course"],
                kind="file",
                display_name="notes.txt",
                original_name="notes.txt",
                mime_type="text/plain",
                size_bytes=12,
                storage_key=key,
                doc_status="ready",
            )
        )
        await db.commit()
    await login_as(client, alice)
    with_files = await _export(client, run_jobs, include_files=True)
    without = await _export(client, run_jobs)

    async def restore(email: str, archive: bytes) -> tuple[UserHandle, dict[str, Any]]:
        user = await make_user(email=email)
        async with _client(app) as other:
            await login_as(other, user)
            upload_id = (await _upload(other, archive)).json()["id"]
            started = await other.post(f"/me/imports/{upload_id}:start", json={"mode": "merge"})
            assert started.status_code == 200, started.text
            await run_jobs()
            return user, (await other.get(f"/me/imports/{upload_id}")).json()

    bob, done = await restore("bob@example.com", with_files)
    assert done["status"] == "imported", done
    assert done["report"]["imported"]["files"] == {"folders": 1, "items": 2}
    async with app.state.session_factory() as db:
        copy = await db.scalar(
            select(FilesItem).where(FilesItem.user_id == bob.id, FilesItem.kind == "file")
        )
    assert copy is not None
    assert copy.storage_key == files_service.storage_key(bob.id, copy.id)
    assert copy.size_bytes == 12
    stored = b"".join([c async for c in app.state.storage.open(copy.storage_key)])
    assert stored == b"week 1 notes"
    # The copy was processed again (the parsed document is not in the backup).
    assert copy.doc_status != "none"

    # Without the contents, the file is left out and reported; the link still comes.
    _, done = await restore("carol@example.com", without)
    assert done["report"]["imported"]["files"] == {"folders": 1, "items": 1}
    assert done["report"]["skipped"] == {"files": {"items": 1}}


async def test_replacing_counts_the_quota_without_the_files_it_removes(
    app: FastAPI, client: AsyncClient, make_user: MakeUser, login_as: LoginAs, run_jobs: RunJobs
) -> None:
    alice = await make_user()
    ids = await _seed(app, alice)
    item_id = new_id()
    key = files_service.storage_key(alice.id, item_id)
    await app.state.storage.put(key, _one(b"week 1 notes"), "text/plain")
    async with app.state.session_factory() as db:
        db.add(
            FilesItem(
                id=item_id,
                user_id=alice.id,
                course_id=ids["course"],
                kind="file",
                display_name="notes.txt",
                original_name="notes.txt",
                mime_type="text/plain",
                size_bytes=12,
                storage_key=key,
                doc_status="ready",
            )
        )
        await db.commit()
    await login_as(client, alice)
    archive = await _export(client, run_jobs, include_files=True)
    # 8 bytes are left, but the restore replaces the file's 12 bytes with the backup's 12.
    used = (await client.get("/storage/usage")).json()["used_bytes"]
    app.state.settings.user_storage_quota_bytes = used + 8
    upload_id = (await _upload(client, archive)).json()["id"]
    started = await client.post(
        f"/me/imports/{upload_id}:start",
        json={"mode": "replace", "confirmation": "Replace my data"},
    )
    assert started.status_code == 200, started.text
    await run_jobs()
    done = (await client.get(f"/me/imports/{upload_id}")).json()
    assert done["status"] == "imported", done["error_code"]
    async with app.state.session_factory() as db:
        sizes = list(
            await db.scalars(
                select(FilesItem.size_bytes).where(
                    FilesItem.user_id == alice.id, FilesItem.kind == "file"
                )
            )
        )
    assert sizes == [12]


async def test_copying_stops_once_the_files_pass_the_quota(
    app: FastAPI,
    client: AsyncClient,
    make_user: MakeUser,
    login_as: LoginAs,
    run_jobs: RunJobs,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stored: list[str] = []

    async def export(ctx: Ctx, writer: Any) -> None:
        async def chunks() -> AsyncIterator[bytes]:
            yield b"file body"

        writer.write_json({"schema_version": 1})
        for name in ("note-1", "note-2", "note-3"):
            await writer.add_file(name, chunks())

    async def import_files(ctx: Ctx, payload: Any, id_map: Any, options: Any) -> ImportReport:
        for name in ("note-1", "note-2", "note-3"):
            await options.files.store(name, f"users/{ctx.user_id}/aa/{name}", "text/plain")
            stored.append(name)
        return ImportReport({"notes": 3})

    async def preview(payload: Any) -> dict[str, int]:
        return {}

    async def nothing(ctx: Ctx) -> None:
        return None

    async def nothing_content(ctx: Ctx, preferences: bool) -> None:
        return None

    adapter = Adapter(
        "aa_files", 1, (), export, import_files, preview, nothing, nothing_content, ()
    )
    monkeypatch.setitem(registry._adapters, "aa_files", adapter)  # pyright: ignore[reportPrivateUsage]
    await login_as(client, await make_user())
    archive = await _export(client, run_jobs, include_files=True)
    app.state.settings.user_storage_quota_bytes = 10
    upload_id = (await _upload(client, archive)).json()["id"]
    # A replace is not refused up front, since the old files make room.
    started = await client.post(
        f"/me/imports/{upload_id}:start",
        json={"mode": "replace", "confirmation": "Replace my data"},
    )
    assert started.status_code == 200, started.text
    await run_jobs()

    done = (await client.get(f"/me/imports/{upload_id}")).json()
    assert (done["status"], done["error_code"]) == ("failed", "common.quota_exceeded")
    assert stored == ["note-1"]  # the second copy was cut off, the third never started


async def test_files_are_copied_before_the_import_takes_the_write_lock(
    app: FastAPI,
    client: AsyncClient,
    make_user: MakeUser,
    login_as: LoginAs,
    run_jobs: RunJobs,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    alice = await make_user(email="alice@example.com")
    ids = await _seed(app, alice)
    item_id = new_id()
    key = files_service.storage_key(alice.id, item_id)
    await app.state.storage.put(key, _one(b"week 1 notes"), "text/plain")
    async with app.state.session_factory() as db:
        db.add(
            FilesItem(
                id=item_id,
                user_id=alice.id,
                course_id=ids["course"],
                kind="file",
                display_name="notes.txt",
                original_name="notes.txt",
                mime_type="text/plain",
                size_bytes=12,
                storage_key=key,
                doc_status="ready",
            )
        )
        await db.commit()
    await login_as(client, alice)
    archive = await _export(client, run_jobs, include_files=True)

    bob = await make_user(email="bob@example.com")
    storage = app.state.storage
    put = storage.put
    saved_meanwhile: list[str] = []

    async def put_while_someone_saves(target: str, *args: Any, **kwargs: Any) -> Any:
        if target.startswith(f"users/{bob.id}/files/"):
            # Another user's save while the file is copied: it must not wait for the import.
            async with app.state.session_factory() as db:
                await db.execute(
                    text("PRAGMA busy_timeout = 100")
                )  # fail fast instead of waiting 5 s
                await db.execute(
                    update(AuthUser).where(AuthUser.id == alice.id).values(display_name="Saved")
                )
                await db.commit()
            saved_meanwhile.append(target)
        return await put(target, *args, **kwargs)

    monkeypatch.setattr(storage, "put", put_while_someone_saves)
    async with _client(app) as other:
        await login_as(other, bob)
        upload_id = (await _upload(other, archive)).json()["id"]
        await other.post(f"/me/imports/{upload_id}:start", json={"mode": "merge"})
        await run_jobs()
        done = (await other.get(f"/me/imports/{upload_id}")).json()
    assert done["status"] == "imported", done
    assert saved_meanwhile


async def test_rejects_old_and_broken_backups(
    client: AsyncClient, make_user: MakeUser, login_as: LoginAs
) -> None:
    await login_as(client, await make_user())
    legacy = json.dumps({"version": "2.2.3", "exported_at": "2026", "programs": []}).encode()
    response = await _upload(client, legacy, "semestra.json")
    assert response.json()["error"]["code"] == "portability.legacy_backup"

    response = await _upload(client, b"not a backup")
    assert response.json()["error"]["code"] == "portability.invalid_archive"

    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr("manifest.json", json.dumps({"format": "semestra-backup", "version": 2}))
    response = await _upload(client, out.getvalue())
    error = response.json()["error"]
    assert error["code"] == "portability.unsupported_version"
    assert error["params"] == {"version": "2"}


async def test_refuses_oversized_data_entries(
    client: AsyncClient, make_user: MakeUser, login_as: LoginAs, run_jobs: RunJobs
) -> None:
    user = await make_user()
    await login_as(client, user)
    archive = await _export(client, run_jobs)
    monkey = pytest.MonkeyPatch()
    monkey.setattr("semestra.modules.portability.archive.DATA_MAX_BYTES", 100)
    try:
        response = await _upload(client, archive)
    finally:
        monkey.undo()
    assert response.json()["error"]["code"] == "portability.invalid_archive"


async def test_an_import_whose_job_died_can_be_discarded(
    app: FastAPI, client: AsyncClient, make_user: MakeUser, login_as: LoginAs, run_jobs: RunJobs
) -> None:
    user = await make_user()
    await login_as(client, user)
    archive = await _export(client, run_jobs)
    upload_id = (await _upload(client, archive)).json()["id"]
    started = (await client.post(f"/me/imports/{upload_id}:start", json={"mode": "merge"})).json()
    assert started["status"] == "importing"

    # The worker was killed mid-import: the job is failed, the upload never heard of it.
    async with app.state.session_factory() as db:
        job = await db.get(CoreJob, started["job_id"])
        assert job is not None
        job.status = "failed"
        await db.commit()

    current = (await client.get(f"/me/imports/{upload_id}")).json()
    assert current["status"] == "failed"
    assert current["error_code"] == "common.internal"
    assert (await client.delete(f"/me/imports/{upload_id}")).status_code == 200


async def test_upload_over_the_limit_is_refused(
    app: FastAPI, client: AsyncClient, make_user: MakeUser, login_as: LoginAs
) -> None:
    app.state.settings.user_storage_quota_bytes = 10
    monkey = pytest.MonkeyPatch()
    monkey.setattr("semestra.modules.portability.service.UPLOAD_HEADROOM", 10)
    try:
        await login_as(client, await make_user())
        response = await _upload(client, b"x" * 100)
    finally:
        monkey.undo()
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "portability.too_large"


async def test_an_oversized_upload_is_refused_while_it_arrives(
    app: FastAPI, client: AsyncClient, make_user: MakeUser, login_as: LoginAs
) -> None:
    app.state.settings.user_storage_quota_bytes = 10
    await login_as(client, await make_user())
    seen = 0

    async def body() -> AsyncIterator[bytes]:
        nonlocal seen
        yield b'--b\r\nContent-Disposition: form-data; name="file"; filename="a.zip"\r\n\r\n'
        for _ in range(64):
            seen += 1
            yield b"0" * (1024 * 1024)
        yield b"\r\n--b--\r\n"

    with pytest.MonkeyPatch.context() as monkey:
        monkey.setattr("semestra.modules.portability.service.UPLOAD_HEADROOM", 10)
        r = await client.post(
            "/me/imports",
            content=body(),
            headers={"Content-Type": "multipart/form-data; boundary=b"},
        )
    assert (r.status_code, r.json()["error"]["code"]) == (413, "portability.too_large")
    assert seen < 64  # stopped reading long before the end


async def test_backups_do_not_pile_up(
    app: FastAPI, client: AsyncClient, make_user: MakeUser, login_as: LoginAs, run_jobs: RunJobs
) -> None:
    from semestra.modules.portability.models import PortabilityArchive

    user = await make_user()
    await login_as(client, user)
    first = (await client.post("/me/exports", json={"include_files": False})).json()
    again = (await client.post("/me/exports", json={"include_files": False})).json()
    assert again["id"] == first["id"]  # still being built: the same export comes back
    await run_jobs()
    for _ in range(4):
        await _export(client, run_jobs)
    archive = await _export(client, run_jobs)

    async def archives(kind: str) -> list[PortabilityArchive]:
        async with app.state.session_factory() as db:
            rows = await db.scalars(
                select(PortabilityArchive).where(
                    PortabilityArchive.user_id == user.id, PortabilityArchive.kind == kind
                )
            )
            return list(rows.all())

    kept = await archives("export")
    assert len(kept) == 3
    for row in kept:
        assert row.storage_key is not None
        assert await app.state.storage.exists(row.storage_key)

    one = (await _upload(client, archive)).json()
    two = (await _upload(client, archive)).json()
    uploads = await archives("import")
    assert [u.id for u in uploads] == [two["id"]]  # the earlier upload was replaced
    assert (await client.get(f"/me/imports/{one['id']}")).status_code == 404

    for _ in range(8):
        await _upload(client, archive)
    limited = await _upload(client, archive)
    assert limited.json()["error"]["code"] == "common.rate_limited"


async def test_downloads_expire_and_are_private(
    app: FastAPI,
    client: AsyncClient,
    clock: Clock,
    make_user: MakeUser,
    login_as: LoginAs,
    run_jobs: RunJobs,
) -> None:
    user = await make_user()
    await login_as(client, user)
    await _export(client, run_jobs)
    export_id = (await client.get("/me/exports")).json()["items"][0]["id"]

    async with _client(app) as other:
        await login_as(other, await make_user(email="other@example.com"))
        assert (await other.get(f"/me/exports/{export_id}/download")).status_code == 404

    clock.advance(hours=25)
    assert (await client.get(f"/me/exports/{export_id}/download")).status_code == 404
    assert (await client.get("/me/exports")).json()["items"] == []
    await app.state.jobs.run_until_idle()
    from semestra.core.jobs import run_periodic

    await run_periodic(app.state, "portability.cleanup")
    root = anyio.Path(app.state.settings.storage_local_root)
    assert [p async for p in root.glob("users/*/portability/*")] == []


async def test_capabilities_are_not_offered_to_agents_or_tokens(app: FastAPI) -> None:
    from semestra.core.capability import registry as capabilities

    for cap in capabilities.list():
        if cap.name.startswith("portability.") or cap.name == "account.delete":
            assert cap.expose == ("http",), cap.name


# --- account deletion -----------------------------------------------------------------------


async def test_account_deletion(
    app: FastAPI,
    client: AsyncClient,
    clock: Clock,
    mailer: MemoryMailer,
    make_user: MakeUser,
    login_as: LoginAs,
    run_jobs: RunJobs,
    bearer_for: Callable[[UserHandle], Awaitable[dict[str, str]]],
) -> None:
    user = await make_user(locale="zh-CN")
    other = await make_user(email="other@example.com")
    await _seed(app, user)
    await _seed(app, other)
    storage = app.state.storage
    await storage.put(f"users/{user.id}/avatar/abc", _one(b"img"), "image/webp")
    await storage.put(f"users/{other.id}/avatar/abc", _one(b"img"), "image/webp")
    await login_as(client, user)
    native = await bearer_for(user)
    token = await client.post("/account/tokens", json={"name": "cli", "scopes": ["read"]})
    assert token.status_code == 200, token.text
    pat = token.json()["token"]

    body = {"confirmation": "删除我的账户", "acknowledged": True}
    mismatch = await client.post("/me:delete", json={**body, "confirmation": "delete"})
    assert mismatch.json()["error"]["code"] == "portability.confirmation_mismatch"
    unticked = await client.post("/me:delete", json={**body, "acknowledged": False})
    assert unticked.json()["error"]["code"] == "portability.confirmation_mismatch"

    clock.advance(minutes=11)
    stale = await client.post("/me:delete", json=body)
    assert stale.status_code == 403
    assert stale.json()["error"] == {
        "code": "auth.reauth_required",
        "params": {"password": False},
        "request_id": stale.json()["error"]["request_id"],
    }
    clock.advance(minutes=-11)

    deleted = await client.post("/me:delete", json=body)
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["kind"] == "portability.account_delete"
    # Locked at once: every session and token stops working before the job runs.
    assert (await client.get("/account/me")).status_code == 401
    async with _client(app) as fresh:
        assert (await fresh.get("/account/me", headers=native)).status_code == 401
        pat_headers = {"Authorization": f"Bearer {pat}"}
        assert (await fresh.get("/programs", headers=pat_headers)).status_code == 401
    async with app.state.session_factory() as db:  # the address is free to sign up again
        locked = await db.get(AuthUser, user.id)
        assert locked is not None
        assert locked.email == f"deleted+{user.id}@invalid"

    await run_jobs()
    for table in _user_tables():
        assert await _count(app, table, user.id) == 0, table.name
        assert await _count(app, table, other.id) > 0, table.name
    async with app.state.session_factory() as db:
        assert await db.get(AuthUser, user.id) is None
        assert await db.get(AuthUser, other.id) is not None
    assert not await storage.exists(f"users/{user.id}/avatar/abc")
    assert await storage.exists(f"users/{other.id}/avatar/abc")
    assert mailer.outbox[-1].to == user.email
    assert "已删除" in mailer.outbox[-1].content.subject


async def test_account_deletion_with_a_password_after_the_window(
    app: FastAPI, client: AsyncClient, clock: Clock, make_user: MakeUser, login_as: LoginAs
) -> None:
    user = await make_user(password="correct horse battery")
    await login_as(client, user)
    clock.advance(minutes=30)
    body = {"confirmation": "delete my account", "acknowledged": True}
    stale = await client.post("/me:delete", json=body)
    assert stale.json()["error"]["params"] == {"password": True}
    wrong = await client.post("/me:delete", json={**body, "password": "nope"})
    assert wrong.json()["error"]["code"] == "auth.invalid_credentials"
    ok = await client.post("/me:delete", json={**body, "password": "correct horse battery"})
    assert ok.status_code == 200, ok.text


async def test_cleanup_finishes_a_deletion_whose_job_never_ran(
    app: FastAPI, client: AsyncClient, clock: Clock, make_user: MakeUser, login_as: LoginAs
) -> None:
    from semestra.core.jobs import run_periodic

    user = await make_user()
    await _seed(app, user)
    await login_as(client, user)
    body = {"confirmation": "delete my account", "acknowledged": True}
    assert (await client.post("/me:delete", json=body)).status_code == 200
    clock.advance(hours=2)
    await run_periodic(app.state, "portability.cleanup")
    async with app.state.session_factory() as db:
        assert await db.get(AuthUser, user.id) is None
        terms = await db.scalar(
            select(func.count()).select_from(AcademicsTerm).where(AcademicsTerm.user_id == user.id)
        )
    assert terms == 0


async def _one(data: bytes) -> AsyncIterator[bytes]:
    yield data


def test_adapter_tables_exist() -> None:
    # Guards the coverage test: a misspelt table name would never be checked.
    known = {t.name for t in Base.metadata.sorted_tables}
    for adapter in registry.adapters():
        for table in adapter.tables:
            assert table in known, (adapter.module, table)
