"""The display of platform HTML (`lms.display`) was the Canvas tab's own setting in 2.0
(`plugin.canvas-tab`): a choice made then holds after upgrading and in a 2.0 backup."""

import io
import json
import sqlite3
import zipfile
from pathlib import Path
from typing import Any

from alembic import command
from alembic.config import Config

from semestra.modules.lms.tests.conftest import Api
from semestra.modules.lms.tests.test_sync_files import made_by
from semestra.testing import API_DIR


def test_migration_moves_the_canvas_tab_display_setting(tmp_path: Path):
    path = tmp_path / "m.db"
    cfg = Config(str(API_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(API_DIR / "migrations"))
    cfg.attributes["database_url"] = f"sqlite+aiosqlite:///{path}"
    command.upgrade(cfg, "0063")
    db = sqlite3.connect(path)  # foreign keys are off: no user rows needed
    rows = [
        ("1", "u1", "plugin.canvas-tab", {"display": "original"}),
        ("2", "u1", "lms", {"sync_every": "1d"}),  # kept beside it
        ("3", "u2", "plugin.canvas-tab", {"display": "original"}),
        ("4", "u2", "lms", {"display": "simplified"}),  # chosen since: theirs
        ("5", "u3", "plugin.canvas-tab", {"display": "original"}),  # no lms row yet
    ]
    for row_id, user, namespace, data in rows:
        db.execute(
            "INSERT INTO settings_values (id, user_id, namespace, scope_type, scope_id, data,"
            " created_at, updated_at) VALUES (?, ?, ?, 'account', '', ?, '2026-01-01',"
            " '2026-01-01')",
            (row_id, user, namespace, json.dumps(data)),
        )
    db.commit()
    db.close()
    command.upgrade(cfg, "head")
    db = sqlite3.connect(path)
    got = db.execute(
        "SELECT user_id, namespace, data FROM settings_values ORDER BY user_id, namespace"
    ).fetchall()
    db.close()
    assert [(u, ns, json.loads(d)) for u, ns, d in got] == [
        ("u1", "lms", {"sync_every": "1d", "display": "original"}),
        ("u2", "lms", {"display": "simplified"}),
        ("u3", "lms", {"display": "original"}),
    ]


def _as_2_0(archive: bytes) -> bytes:
    """The backup as 2.0 wrote it: the display setting in the Canvas tab's namespace (a backup
    of 2.1 to 2.4 kept that row as it was)."""
    source = zipfile.ZipFile(io.BytesIO(archive))
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        for name in source.namelist():
            data = source.read(name)
            if name == "manifest.json":
                data = made_by(data, "2.4.0")  # 2.1 to 2.4 kept the old row too
            elif name == "data/settings.json":
                payload: dict[str, Any] = json.loads(data)
                rows: list[dict[str, Any]] = payload["values"]
                [lms] = [r for r in rows if r["namespace"] == "lms"]
                display = lms["data"].pop("display")
                rows.append({**lms, "id": "canvas", "namespace": "plugin.canvas-tab",
                             "data": {"display": display}})  # fmt: skip
                data = json.dumps(payload).encode()
            z.writestr(name, data)
    return out.getvalue()


async def test_a_2_0_backup_keeps_the_display_setting(api: Api):
    values = {"display": "original", "sync_every": "1d"}
    await api.call("PATCH", "/me/settings/lms", json={"values": values})
    started = await api.call("POST", "/me/exports", json={"include_files": False})
    await api.run_jobs()
    archive = (await api.client.get(f"/me/exports/{started['id']}/download")).content
    await api.call("PATCH", "/me/settings/lms", json={"values": {"display": "simplified"}})

    uploaded = await api.client.post(
        "/me/imports", files={"file": ("backup.zip", _as_2_0(archive), "application/zip")}
    )
    body = {"mode": "merge", "include_preferences": True}
    await api.call("POST", f"/me/imports/{uploaded.json()['id']}:start", json=body)
    await api.run_jobs()
    got = await api.call("GET", "/me/settings/lms", params={"scope_type": "account"})
    assert {k: got["values"][k] for k in values} == values
