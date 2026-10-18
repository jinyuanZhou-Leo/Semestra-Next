import type { CardSize } from '../extensions'

/**
 * Board geometry (M10 §5.2), the same rules as the backend's `layouts/grid.py`: 4 columns,
 * s = 1×1, m = 2×1, l = 2×2, xl = 4×2. Layouts are stored for 4 columns; narrower screens
 * flow the cards in reading order instead.
 */
export const COLS = 4

export const SPANS: Record<CardSize, readonly [w: number, h: number]> = {
  s: [1, 1],
  m: [2, 1],
  l: [2, 2],
  xl: [4, 2],
}

export type LayoutItem = { id: string; size: CardSize; x: number; y: number }

function overlaps(a: LayoutItem, x: number, y: number, w: number, h: number): boolean {
  const [aw, ah] = SPANS[a.size]
  return a.x < x + w && x < a.x + aw && a.y < y + h && y < a.y + ah
}

function free(placed: readonly LayoutItem[], x: number, y: number, size: CardSize): boolean {
  const [w, h] = SPANS[size]
  return placed.every((p) => !overlaps(p, x, y, w, h))
}

function clampX(x: number, size: CardSize): number {
  return Math.min(Math.max(x, 0), COLS - SPANS[size][0])
}

const readingOrder = (a: LayoutItem, b: LayoutItem) => a.y - b.y || a.x - b.x

/** Moves every card up as far as it goes, in reading order; columns are kept. */
export function compact<T extends LayoutItem>(items: readonly T[]): T[] {
  const out: T[] = []
  for (const item of [...items].sort(readingOrder)) {
    const x = clampX(item.x, item.size)
    let y = 0
    while (!free(out, x, y, item.size)) y++
    out.push({ ...item, x, y })
  }
  return out
}

/** Top-most, then left-most position where a card of `size` fits. */
export function firstFree(items: readonly LayoutItem[], size: CardSize): { x: number; y: number } {
  for (let y = 0; ; y++) {
    for (let x = 0; x <= COLS - SPANS[size][0]; x++) {
      if (free(items, x, y, size)) return { x, y }
    }
  }
}

/**
 * The layout while `id` is dragged to (x, y): the dragged card keeps that spot, the others
 * make way (each goes to the highest free row in its column range), then everything compacts.
 */
export function moveItem<T extends LayoutItem>(
  items: readonly T[],
  id: string,
  x: number,
  y: number,
): T[] {
  const moving = items.find((i) => i.id === id)
  if (!moving) return [...items]
  const target = { ...moving, x: clampX(x, moving.size), y: Math.max(0, y) }
  const placed: T[] = [target]
  for (const item of items.filter((i) => i.id !== id).sort(readingOrder)) {
    let row = 0
    while (!free(placed, item.x, row, item.size)) row++
    placed.push({ ...item, y: row })
  }
  return compact(placed)
}

/** Changes a card's size and lets the others make way. */
export function resizeItem<T extends LayoutItem>(
  items: readonly T[],
  id: string,
  size: CardSize,
): T[] {
  const item = items.find((i) => i.id === id)
  if (!item) return [...items]
  const resized = items.map((i) => (i.id === id ? { ...i, size, x: clampX(i.x, size) } : i))
  return moveItem(resized, id, clampX(item.x, size), item.y)
}

/** Number of rows the layout uses. */
export function rows(items: readonly LayoutItem[]): number {
  return items.reduce((max, i) => Math.max(max, i.y + SPANS[i.size][1]), 0)
}

export function sameLayout(a: readonly LayoutItem[], b: readonly LayoutItem[]): boolean {
  if (a.length !== b.length) return false
  const byId = new Map(b.map((i) => [i.id, i]))
  return a.every((i) => {
    const o = byId.get(i.id)
    return o !== undefined && o.size === i.size && o.x === i.x && o.y === i.y
  })
}
