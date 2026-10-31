import type { CardPosition } from '@semestra/api-client'
import type { CardSize } from '../extensions'

/**
 * Board geometry (M10 §5.2), the same rules as the backend's `layouts/grid.py`: s = 1×1,
 * m = 2×1, l = 2×2, xl = 4×2 on a 4-column grid. Wide boards use 6 or 8 columns, where a card
 * keeps its own position once the user placed it there (`positions`); narrow boards (1 or 2
 * columns) flow the cards in reading order and are not stored.
 */
export const COLS = 4
export const WIDE_COLS = [6, 8] as const
export type WideCols = (typeof WIDE_COLS)[number]

export const SPANS: Record<CardSize, readonly [w: number, h: number]> = {
  s: [1, 1],
  m: [2, 1],
  l: [2, 2],
  xl: [4, 2],
}

/** Columns for a board of `width` px: cards stay about 230–340 px wide. */
export function columnsFor(width: number): number {
  if (width < 440) return 1
  if (width < 720) return 2
  if (width < 1400) return 4
  if (width < 1800) return 6
  return 8
}

/** A card's span on a grid of `cols` columns (narrow grids cut wide cards down). */
export function span(size: CardSize, cols: number = COLS): readonly [w: number, h: number] {
  const [w, h] = SPANS[size]
  return [Math.min(w, cols), h]
}

/** The size whose span is w×h, if any. */
export function sizeOf(w: number, h: number): CardSize | undefined {
  return (Object.keys(SPANS) as CardSize[]).find((s) => SPANS[s][0] === w && SPANS[s][1] === h)
}

/**
 * Where a corner resize lands: the card's sizes from smallest to largest area form a ladder, and
 * dragging the corner `steps` cells right or down (negative: back) walks that many rungs from
 * `from`. Walking one ladder instead of matching width and height apart lets a card in the last
 * column grow by dragging down, and never sticks between two sizes equally far away.
 */
export function stepSize(sizes: readonly CardSize[], from: CardSize, steps: number): CardSize {
  const ladder = [...sizes].sort((a, b) => {
    const [aw, ah] = SPANS[a]
    const [bw, bh] = SPANS[b]
    return aw * ah - bw * bh || aw - bw
  })
  const at = Math.max(ladder.indexOf(from), 0)
  return ladder[Math.min(Math.max(at + steps, 0), ladder.length - 1)] ?? from
}

export type LayoutItem = { id: string; size: CardSize; x: number; y: number }

function overlaps(a: LayoutItem, cols: number, x: number, y: number, w: number, h: number) {
  const [aw, ah] = span(a.size, cols)
  return a.x < x + w && x < a.x + aw && a.y < y + h && y < a.y + ah
}

function free(placed: readonly LayoutItem[], cols: number, x: number, y: number, size: CardSize) {
  const [w, h] = span(size, cols)
  return placed.every((p) => !overlaps(p, cols, x, y, w, h))
}

function clampX(x: number, size: CardSize, cols: number): number {
  return Math.min(Math.max(x, 0), cols - span(size, cols)[0])
}

const readingOrder = (a: LayoutItem, b: LayoutItem) => a.y - b.y || a.x - b.x

/** Moves every card up as far as it goes, in reading order; columns are kept. */
export function compact<T extends LayoutItem>(items: readonly T[], cols: number = COLS): T[] {
  const out: T[] = []
  for (const item of [...items].sort(readingOrder)) {
    const x = clampX(item.x, item.size, cols)
    let y = 0
    while (!free(out, cols, x, y, item.size)) y++
    out.push({ ...item, x, y })
  }
  return out
}

/** Top-most, then left-most position where a card of `size` fits. */
export function firstFree(
  items: readonly LayoutItem[],
  size: CardSize,
  cols: number = COLS,
): { x: number; y: number } {
  for (let y = 0; ; y++) {
    for (let x = 0; x <= cols - span(size, cols)[0]; x++) {
      if (free(items, cols, x, y, size)) return { x, y }
    }
  }
}

/**
 * The layout after `id` moves to (x, y): the moved card keeps that spot, the others make way
 * (each goes to the highest free row in its column range), then everything compacts.
 */
export function moveItem<T extends LayoutItem>(
  items: readonly T[],
  id: string,
  x: number,
  y: number,
  cols: number = COLS,
): T[] {
  const moving = items.find((i) => i.id === id)
  if (!moving) return [...items]
  const target = { ...moving, x: clampX(x, moving.size, cols), y: Math.max(0, y) }
  const placed: T[] = [target]
  for (const item of items.filter((i) => i.id !== id).sort(readingOrder)) {
    let row = 0
    while (!free(placed, cols, item.x, row, item.size)) row++
    placed.push({ ...item, y: row })
  }
  return compact(placed, cols)
}

/** Changes a card's size and lets the others make way. */
export function resizeItem<T extends LayoutItem>(
  items: readonly T[],
  id: string,
  size: CardSize,
  cols: number = COLS,
): T[] {
  const item = items.find((i) => i.id === id)
  if (!item) return [...items]
  const resized = items.map((i) => (i.id === id ? { ...i, size } : i))
  return moveItem(resized, id, clampX(item.x, size, cols), item.y, cols)
}

export function sameLayout(a: readonly LayoutItem[], b: readonly LayoutItem[]): boolean {
  if (a.length !== b.length) return false
  const byId = new Map(b.map((i) => [i.id, i]))
  return a.every((i) => {
    const o = byId.get(i.id)
    return o !== undefined && o.size === i.size && o.x === i.x && o.y === i.y
  })
}

// --- layouts per column count -------------------------------------------------------------

/** A card with its 4-column position and the positions it has on the wide grids. */
export type PlacedCard = LayoutItem & { positions: CardPosition[] }

const isWide = (cols: number): cols is WideCols => (WIDE_COLS as readonly number[]).includes(cols)

/**
 * Where the cards go on a grid of `cols` columns. 4 columns: the stored positions. 6 or 8: the
 * cards placed there keep their spots, the others fill the first free cells in reading order.
 * Fewer: every card in reading order.
 */
export function layoutAt(cards: readonly PlacedCard[], cols: number): LayoutItem[] {
  const base = compact(cards.map(({ id, size, x, y }) => ({ id, size, x, y })))
  if (cols === COLS) return base
  const own = new Map<string, CardPosition>()
  if (isWide(cols)) {
    for (const c of cards) {
      const p = c.positions.find((q) => q.cols === cols)
      if (p) own.set(c.id, p)
    }
  }
  const out = compact(
    base.flatMap((c) => {
      const p = own.get(c.id)
      return p ? [{ ...c, x: p.x, y: p.y }] : []
    }),
    cols,
  )
  for (const c of base) {
    if (!own.has(c.id)) out.push({ ...c, ...firstFree(out, c.size, cols) })
  }
  return out
}

/**
 * Takes `items` (a layout on `cols` columns, e.g. after a drag) back into the cards: sizes
 * always, positions for 4 columns or a wide grid. Narrow layouts are not stored.
 */
export function applyLayout<T extends PlacedCard>(
  cards: readonly T[],
  cols: number,
  items: readonly LayoutItem[],
): T[] {
  const byId = new Map(items.map((i) => [i.id, i]))
  return cards.map((c) => {
    const item = byId.get(c.id)
    if (!item) return c
    if (cols === COLS) return { ...c, size: item.size, x: item.x, y: item.y }
    if (isWide(cols)) {
      const positions = [
        ...c.positions.filter((p) => p.cols !== cols),
        { cols, x: item.x, y: item.y },
      ].sort((a, b) => a.cols - b.cols)
      return { ...c, size: item.size, positions }
    }
    return { ...c, size: item.size }
  })
}

/**
 * The cards as they are saved: compacted on 4 columns, and on each wide grid the user arranged
 * every card gets its current spot there (so sizes changed elsewhere cannot leave overlaps).
 */
export function normalize<T extends PlacedCard>(cards: readonly T[]): T[] {
  let out = applyLayout(cards, COLS, layoutAt(cards, COLS))
  for (const cols of WIDE_COLS) {
    if (out.some((c) => c.positions.some((p) => p.cols === cols))) {
      out = applyLayout(out, cols, layoutAt(out, cols))
    }
  }
  return out
}
