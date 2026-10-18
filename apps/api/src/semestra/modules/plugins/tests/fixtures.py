"""A small plugin catalog for tests: academics' real cards plus two test plugins."""

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI

from semestra.modules.plugins import catalog
from semestra.modules.plugins.catalog import PluginInfo

NOTE_SCHEMA = {
    "type": "object",
    "properties": {
        "content": {"type": "string", "maxLength": 50, "default": ""},
        "color": {"type": "string", "enum": ["yellow", "blue"]},
    },
    "additionalProperties": False,
}

TEST_MODULES: list[dict[str, Any]] = [
    {
        "id": "academics",
        "kind": "core",
        "pages": [{"id": "overview", "scopes": ["program", "term", "course"]}],
        "cards": [
            {
                "id": "academics.courseInfo",
                "scopes": ["course"],
                "sizes": ["m", "l"],
                "default_size": "l",
                "multiple": False,
                "settings_schema": None,
            },
            {
                "id": "academics.termCourses",
                "scopes": ["term"],
                "sizes": ["l", "xl"],
                "default_size": "xl",
                "multiple": False,
                "settings_schema": None,
            },
        ],
        "default_board": {
            "course": [{"card": "academics.courseInfo"}],
            "term": [{"card": "academics.termCourses"}],
        },
    },
    {
        "id": "notes",
        "kind": "plugin",
        "pages": [{"id": "notes", "scopes": ["course"]}],
        "cards": [
            {
                "id": "notes.note",
                "scopes": ["program", "term", "course", "today"],
                "sizes": ["s", "m", "l"],
                "default_size": "s",
                "multiple": True,
                "settings_schema": NOTE_SCHEMA,
            }
        ],
        "default_board": {"course": [{"card": "notes.note", "size": "m"}]},
    },
    {
        "id": "solo",
        "kind": "plugin",
        "pages": [],
        "cards": [
            {
                "id": "solo.card",
                "scopes": ["course", "today"],
                "sizes": ["m", "xl"],
                "default_size": "m",
                "multiple": False,
                "settings_schema": None,
            }
        ],
        "default_board": {},
    },
]


@pytest.fixture(autouse=True)
def test_catalog(app: FastAPI, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Swaps in TEST_MODULES; `notes` is installed by default, `solo` is not."""
    del app
    path = tmp_path / "web_manifest.json"
    path.write_text(json.dumps({"modules": TEST_MODULES}))
    monkeypatch.setattr(catalog, "WEB_MANIFEST", path)
    saved = dict(catalog._plugins)  # pyright: ignore[reportPrivateUsage]
    catalog._plugins.clear()  # pyright: ignore[reportPrivateUsage]
    catalog.register_plugin(
        PluginInfo(id="notes", default_installed=True, summary="Sticky notes on cards.")
    )
    catalog.register_plugin(PluginInfo(id="solo"))
    yield
    catalog._plugins.clear()  # pyright: ignore[reportPrivateUsage]
    catalog._plugins.update(saved)  # pyright: ignore[reportPrivateUsage]
    catalog.reload()
