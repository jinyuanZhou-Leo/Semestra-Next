import os
import sqlite3
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from semestra.cli import main as cli_main
from semestra.core.backup import BACKUP_INTERVAL_SECONDS, run_backup, seconds_until_due
from semestra.core.config import Settings
from semestra.core.observability import _scrub, init_sentry  # pyright: ignore[reportPrivateUsage]
from semestra.main import create_app


def _make_db(path: Path, value: str) -> None:
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE t (v TEXT)")
    conn.execute("INSERT INTO t VALUES (?)", (value,))
    conn.commit()
    conn.close()


@pytest.fixture
def web_dist(tmp_path: Path) -> Path:
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>spa</title>")
    (dist / "assets" / "app-abc123.js").write_text("console.log(1)")
    (dist / "favicon.svg").write_text("<svg/>")
    (tmp_path / "secret.txt").write_text("outside")
    return dist


@pytest.fixture
async def web_client(settings: Settings, web_dist: Path) -> AsyncIterator[AsyncClient]:
    app = create_app(settings.model_copy(update={"serve_web": True, "web_dist_dir": web_dist}))
    async with (
        app.router.lifespan_context(app),
        AsyncClient(transport=ASGITransport(app), base_url="http://test") as c,
    ):
        yield c


async def test_serve_web_api_routes_still_win(web_client: AsyncClient) -> None:
    r = await web_client.get("/healthz")
    assert r.json() == {"status": "ok"}


async def test_serve_web_spa_fallback_for_html_navigation(web_client: AsyncClient) -> None:
    r = await web_client.get("/p/123/settings", headers={"accept": "text/html,*/*"})
    assert r.status_code == 200
    assert "<title>spa</title>" in r.text
    assert r.headers["cache-control"] == "no-cache"


async def test_serve_web_non_html_miss_is_json_404(web_client: AsyncClient) -> None:
    r = await web_client.get("/missing", headers={"accept": "application/json"})
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "common.not_found"


async def test_serve_web_hashed_assets_are_immutable(web_client: AsyncClient) -> None:
    r = await web_client.get("/assets/app-abc123.js")
    assert r.status_code == 200
    assert "immutable" in r.headers["cache-control"]
    r = await web_client.get("/favicon.svg")
    assert r.status_code == 200
    assert r.headers["cache-control"] == "no-cache"


@pytest.mark.parametrize(
    "path", ["/../secret.txt", "/%2e%2e/secret.txt", "/assets/../../secret.txt"]
)
async def test_serve_web_blocks_path_traversal(web_client: AsyncClient, path: str) -> None:
    r = await web_client.get(path, headers={"accept": "application/json"})
    assert "outside" not in r.text


def test_serve_web_requires_built_files(settings: Settings, tmp_path: Path) -> None:
    broken = settings.model_copy(update={"serve_web": True, "web_dist_dir": tmp_path / "nope"})
    with pytest.raises(RuntimeError, match=r"index\.html"):
        create_app(broken)


def test_run_backup_snapshots_and_prunes(settings: Settings, tmp_path: Path) -> None:
    db = tmp_path / "test.db"
    _make_db(db, "hello")
    (settings.storage_local_root / "users" / "u1").mkdir(parents=True, exist_ok=True)
    (settings.storage_local_root / "users" / "u1" / "file.bin").write_bytes(b"abc")
    cfg = settings.model_copy(update={"backup_keep": 2, "storage_local_root": tmp_path / "st"})
    (tmp_path / "st" / "users" / "u1").mkdir(parents=True)
    (tmp_path / "st" / "users" / "u1" / "file.bin").write_bytes(b"abc")
    dest = tmp_path / "backups"

    for i in range(3):
        (created,) = run_backup(cfg, dest)
        # distinct timestamps without sleeping
        created.rename(created.with_name(f"semestra-2026010{i}T000000Z.sqlite"))

    snapshots = sorted((dest / "db").glob("semestra-*.sqlite"))
    assert len(snapshots) == 2
    with sqlite3.connect(snapshots[-1]) as conn:
        assert conn.execute("SELECT v FROM t").fetchone() == ("hello",)
    assert (dest / "storage" / "users" / "u1" / "file.bin").read_bytes() == b"abc"


def test_run_backup_db_only_skips_storage(settings: Settings, tmp_path: Path) -> None:
    _make_db(tmp_path / "test.db", "x")
    storage = tmp_path / "st"
    storage.mkdir()
    (storage / "f").write_bytes(b"1")
    cfg = settings.model_copy(update={"storage_local_root": storage})
    run_backup(cfg, tmp_path / "out", include_storage=False)
    assert not (tmp_path / "out" / "storage").exists()


def test_seconds_until_due(settings: Settings, tmp_path: Path) -> None:
    cfg = settings.model_copy(update={"backup_dir": str(tmp_path / "b")})
    assert seconds_until_due(cfg) == 0
    (tmp_path / "b" / "db").mkdir(parents=True)
    snap = tmp_path / "b" / "db" / "semestra-x.sqlite"
    snap.write_bytes(b"")
    now = snap.stat().st_mtime + 3600
    assert seconds_until_due(cfg, now=now) == pytest.approx(BACKUP_INTERVAL_SECONDS - 3600)
    assert seconds_until_due(cfg, now=now + 2 * BACKUP_INTERVAL_SECONDS) == 0


def test_cli_backup(
    settings: Settings,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    _make_db(tmp_path / "cli.db", "x")
    monkeypatch.setenv("SEMESTRA_DATABASE_URL", f"sqlite+aiosqlite:///{tmp_path / 'cli.db'}")
    monkeypatch.setenv("SEMESTRA_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("SEMESTRA_STORAGE_LOCAL_ROOT", str(tmp_path / "none"))
    from semestra.core.config import get_settings

    get_settings.cache_clear()
    try:
        cli_main(["backup", str(tmp_path / "out")])
    finally:
        get_settings.cache_clear()
    printed = capsys.readouterr().out.strip().splitlines()
    assert len(printed) == 1
    assert os.path.exists(printed[0])


def test_sentry_disabled_without_dsn(settings: Settings) -> None:
    assert init_sentry(settings) is False


def test_sentry_scrub_drops_request_content_and_user() -> None:
    event = {
        "request": {"url": "https://x/y", "data": {"password": "p"}, "cookies": {"s": "1"}},
        "user": {"id": "u"},
        "exception": {"values": []},
    }
    out = _scrub(event, {})
    assert out["request"] == {"url": "https://x/y"}
    assert "user" not in out
    assert "exception" in out
