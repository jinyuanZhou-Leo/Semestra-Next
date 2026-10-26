"""Board geometry (M10 §5.2): a 4-column grid of cards sized s=1x1, m=2x1, l=2x2, xl=4x2.

Wide screens show the board on 6 or 8 columns; a card may carry its own position for those
(`Placed.positions`), the frontend places the others. Every function takes the column count.

Mirrors `apps/web/src/app/board/layout.ts`; both sides compact the same way so a layout the
frontend saves comes back unchanged. Both are tested on `tests/grid_cases.json`.
"""

from collections.abc import Iterable, Sequence
from dataclasses import dataclass, replace

from semestra.modules.plugins.catalog import SIZE_SPANS, CardSize

COLS = 4
WIDE_COLS = (6, 8)


@dataclass(frozen=True)
class Placed:
    instance_id: str
    card_id: str
    size: CardSize
    x: int
    y: int
    # (cols, x, y) on the wider grids; absent ones are placed by the frontend.
    positions: tuple[tuple[int, int, int], ...] = ()

    @property
    def w(self) -> int:
        return SIZE_SPANS[self.size][0]

    @property
    def h(self) -> int:
        return SIZE_SPANS[self.size][1]


def _overlaps(a: Placed, x: int, y: int, w: int, h: int) -> bool:
    return a.x < x + w and x < a.x + a.w and a.y < y + h and y < a.y + a.h


def _free(placed: Iterable[Placed], x: int, y: int, w: int, h: int) -> bool:
    return all(not _overlaps(p, x, y, w, h) for p in placed)


def compact(cards: Sequence[Placed], cols: int = COLS) -> list[Placed]:
    """Moves every card up as far as it goes, in reading order (y, then x); x is kept."""
    out: list[Placed] = []
    for card in sorted(cards, key=lambda c: (c.y, c.x)):
        x = min(max(card.x, 0), cols - card.w)
        y = 0
        while not _free(out, x, y, card.w, card.h):
            y += 1
        out.append(replace(card, x=x, y=y))
    return out


def first_free(cards: Sequence[Placed], size: CardSize, cols: int = COLS) -> tuple[int, int]:
    """Top-most, then left-most position where a card of `size` fits."""
    w, h = SIZE_SPANS[size]
    y = 0
    while True:
        for x in range(cols - w + 1):
            if _free(cards, x, y, w, h):
                return x, y
        y += 1


def pack(slots: Iterable[tuple[str, str, CardSize]]) -> list[Placed]:
    """Places (instance_id, card_id, size) one after another at the first free position."""
    out: list[Placed] = []
    for instance_id, card_id, size in slots:
        x, y = first_free(out, size)
        out.append(Placed(instance_id, card_id, size, x, y))
    return out


def valid(cards: Sequence[Placed], cols: int = COLS) -> bool:
    """Inside the columns and without overlaps."""
    seen: list[Placed] = []
    for card in cards:
        if card.x < 0 or card.y < 0 or card.x + card.w > cols:
            return False
        if not _free(seen, card.x, card.y, card.w, card.h):
            return False
        seen.append(card)
    return True


def at_cols(cards: Sequence[Placed], cols: int) -> list[Placed]:
    """The cards that have a position on the `cols`-column grid, moved there."""
    out: list[Placed] = []
    for card in cards:
        for c, x, y in card.positions:
            if c == cols:
                out.append(replace(card, x=x, y=y))
    return out
