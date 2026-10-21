import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path

from httpx import AsyncClient
from sqlalchemy import text

from semestra.core.config import Settings
from semestra.core.db import ensure_sqlite_dir, make_engine, new_id


async def test_healthz(client: AsyncClient) -> None:
    r = await client.get("/healthz")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}
    assert r.headers["x-request-id"]


async def test_readyz(client: AsyncClient) -> None:
    r = await client.get("/readyz")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "database": "ok", "worker": "off"}


async def test_unknown_route_uses_error_envelope(client: AsyncClient) -> None:
    r = await client.get("/nope")
    assert r.status_code == 404
    body = r.json()["error"]
    assert body["code"] == "common.not_found"
    assert body["request_id"] == r.headers["x-request-id"]


async def test_sqlite_pragmas(settings: Settings) -> None:
    engine = make_engine(settings)
    async with engine.connect() as conn:
        assert (await conn.execute(text("PRAGMA foreign_keys"))).scalar_one() == 1
        assert (await conn.execute(text("PRAGMA journal_mode"))).scalar_one() == "wal"
        assert (await conn.execute(text("PRAGMA busy_timeout"))).scalar_one() == 5000
    await engine.dispose()


def test_new_id_is_uuid7_and_sortable() -> None:
    a, b = new_id(), new_id()
    assert a[14] == "7"
    assert a < b


def test_openapi_has_health_operations(settings: Settings) -> None:
    from semestra.main import create_app

    ops = {
        op["operationId"]
        for path in create_app(settings).openapi()["paths"].values()
        for op in path.values()
    }
    assert {"healthz", "readyz"} <= ops


def test_openapi_declares_credentials(settings: Settings) -> None:
    from semestra.main import create_app

    schema = create_app(settings).openapi()
    assert set(schema["components"]["securitySchemes"]) == {
        "sessionCookie",
        "accessToken",
        "personalAccessToken",
    }
    paths = schema["paths"]
    # Capabilities exposed to MCP take personal access tokens; HTTP-only capabilities,
    # hand-written routes and sign-in do not.
    assert {"personalAccessToken": []} in paths["/programs"]["get"]["security"]
    assert {"personalAccessToken": []} not in paths["/account/tokens"]["get"]["security"]
    assert {"personalAccessToken": []} not in paths["/account/avatar"]["post"]["security"]
    assert "security" not in paths["/auth/password/login"]["post"]
    assert "security" not in paths["/healthz"]["get"]


def test_mcp_catalog_lists_tools_and_prompts(settings: Settings) -> None:
    from semestra.main import create_app
    from semestra.modules.agent.mcp_server import catalog

    create_app(settings)
    data = catalog()
    names = {t["name"] for t in data["tools"]}
    assert "academics__course__create" in names
    assert all("." not in n for n in names)
    assert all(set(p["title"]) >= {"en", "zh-CN"} for p in data["prompts"])


def test_now_is_aware() -> None:
    assert datetime.now(UTC).tzinfo is not None


def test_ensure_sqlite_dir_creates_parent(tmp_path: Path) -> None:
    target = tmp_path / "nested" / "dir" / "x.db"
    ensure_sqlite_dir(f"sqlite+aiosqlite:///{target}")
    assert target.parent.is_dir()


def test_starting_the_api_does_not_import_the_ai_sdks() -> None:
    # They take seconds to import; `sdk.warm_up()` loads them in a thread after start instead.
    code = (
        "import sys\n"
        "from semestra.main import create_app\n"
        "create_app()\n"
        "sdks = {'openai', 'anthropic', 'google.genai'}\n"
        "print(sorted(sdks & set(sys.modules)))\n"
        "from semestra.modules.ai.adapters import sdk\n"
        "sdk.warm_up()\n"
        "print(sorted(sdks & set(sys.modules)))\n"
    )
    out = subprocess.run(  # noqa: S603 (our own interpreter and code)
        [sys.executable, "-c", code], capture_output=True, text=True, check=True, timeout=60
    )
    assert out.stdout.splitlines()[-2:] == ["[]", "['anthropic', 'google.genai', 'openai']"]
