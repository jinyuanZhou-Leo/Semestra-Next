"""Board geometry, on the cases the frontend's layout.ts is tested on too (M10 §5.2)."""

import json
from pathlib import Path
from typing import Any

import pytest

from semestra.modules.layouts import grid
from semestra.modules.layouts.grid import Placed

CASES = json.loads((Path(__file__).parent / "grid_cases.json").read_text())


def _cards(rows: list[list[Any]]) -> list[Placed]:
    return [Placed(i, "core.notes", size, x, y) for i, size, x, y in rows]


@pytest.mark.parametrize("case", CASES["compact"], ids=lambda c: c["name"])
def test_compact(case: dict[str, Any]) -> None:
    out = grid.compact(_cards(case["cards"]))
    assert [[p.instance_id, p.size, p.x, p.y] for p in out] == case["expected"]
    assert grid.valid(out)


@pytest.mark.parametrize("case", CASES["first_free"], ids=lambda c: c["name"])
def test_first_free(case: dict[str, Any]) -> None:
    cards = _cards(case["cards"])
    for size, spot in case["sizes"].items():
        assert list(grid.first_free(cards, size)) == spot, size
