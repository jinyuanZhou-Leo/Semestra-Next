import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import type { CardSize } from '../extensions'
import {
  columnsFor,
  compact,
  firstFree,
  type LayoutItem,
  layoutAt,
  moveItem,
  nearestSize,
  normalize,
  type PlacedCard,
  resizeItem,
} from './layout'

const at = (items: LayoutItem[]) =>
  Object.fromEntries(items.map((i) => [i.id, [i.size, i.x, i.y].join(' ')]))

type Row = [id: string, size: CardSize, x: number, y: number]
type Cases = {
  compact: { name: string; cols?: number; cards: Row[]; expected: Row[] }[]
  first_free: {
    name: string
    cols?: number
    cards: Row[]
    sizes: Record<CardSize, [number, number]>
  }[]
}
// The same cases the backend's grid.py is tested on: both sides must place cards alike.
const cases = JSON.parse(
  readFileSync(
    path.resolve(
      import.meta.dirname,
      '../../../../api/src/semestra/modules/layouts/tests/grid_cases.json',
    ),
    'utf8',
  ),
) as Cases
const toItems = (list: Row[]): LayoutItem[] => list.map(([id, size, x, y]) => ({ id, size, x, y }))

describe('compact', () => {
  test.each(cases.compact)('$name', ({ cards, expected, cols }) => {
    expect(compact(toItems(cards), cols)).toEqual(toItems(expected))
  })
})

describe('first free spot', () => {
  test.each(cases.first_free)('$name', ({ cards, sizes, cols }) => {
    for (const [size, [x, y]] of Object.entries(sizes)) {
      expect(firstFree(toItems(cards), size as CardSize, cols)).toEqual({ x, y })
    }
  })
})

describe('moving', () => {
  const items: LayoutItem[] = [
    { id: 'a', size: 'm', x: 0, y: 0 },
    { id: 'b', size: 'm', x: 2, y: 0 },
    { id: 'c', size: 'xl', x: 0, y: 1 },
  ]

  test('the dragged card takes the spot and the others make way', () => {
    expect(at(moveItem(items, 'c', 0, 0))).toEqual({ c: 'xl 0 0', a: 'm 0 2', b: 'm 2 2' })
  })

  test('dragging into empty space below lets the card float back up', () => {
    expect(at(moveItem(items, 'a', 0, 9))).toEqual({ a: 'm 0 0', b: 'm 2 0', c: 'xl 0 1' })
    expect(at(moveItem(items, 'a', 2, 9))).toEqual({ b: 'm 2 0', c: 'xl 0 1', a: 'm 2 3' })
  })

  test('the target column is clamped to the grid', () => {
    expect(at(moveItem(items, 'b', 5, 0))).toEqual({ a: 'm 0 0', b: 'm 2 0', c: 'xl 0 1' })
  })

  test('resizing makes room below', () => {
    const resized = resizeItem(items, 'a', 'l')
    expect(at(resized)).toEqual({ a: 'l 0 0', b: 'm 2 0', c: 'xl 0 2' })
  })

  test('on a wider grid the others make way within its columns', () => {
    expect(at(moveItem(items, 'b', 4, 0, 8))).toEqual({ a: 'm 0 0', b: 'm 4 0', c: 'xl 0 1' })
  })
})

describe('resizing by dragging', () => {
  test('snaps to the closest size the card supports', () => {
    expect(nearestSize(['s', 'm', 'l'], 2, 2)).toBe('l')
    expect(nearestSize(['s', 'm', 'l'], 4, 2)).toBe('l')
    expect(nearestSize(['m', 'xl'], 1, 1)).toBe('m')
    expect(nearestSize(['s', 'l'], 2, 1)).toBe('s')
  })
})

describe('layouts per column count', () => {
  const card = (id: string, size: CardSize, x: number, y: number): PlacedCard => ({
    id,
    size,
    x,
    y,
    positions: [],
  })
  const cards = [
    card('a', 'xl', 0, 0),
    card('b', 'l', 0, 2),
    card('c', 'l', 2, 2),
    card('d', 's', 0, 4),
  ]

  test('the column count follows the board width', () => {
    expect([500, 700, 1136, 1616, 2256].map(columnsFor)).toEqual([1, 2, 4, 6, 8])
  })

  test('a wide grid without stored positions fills in reading order', () => {
    expect(at(layoutAt(cards, 8))).toEqual({ a: 'xl 0 0', b: 'l 4 0', c: 'l 6 0', d: 's 0 2' })
  })

  test('stored wide positions are kept, other cards fill the gaps', () => {
    const placed = cards.map((c) =>
      c.id === 'c' ? { ...c, positions: [{ cols: 8 as const, x: 0, y: 0 }] } : c,
    )
    expect(at(layoutAt(placed, 8))).toEqual({ c: 'l 0 0', a: 'xl 2 0', b: 'l 6 0', d: 's 0 2' })
  })

  test('narrow grids cut wide cards down and flow in order', () => {
    expect(layoutAt(cards, 2).map((i) => [i.id, i.x, i.y])).toEqual([
      ['a', 0, 0],
      ['b', 0, 2],
      ['c', 0, 4],
      ['d', 0, 6],
    ])
  })

  test('saving fills every card in on the wide grids the user arranged', () => {
    const placed = cards.map((c) =>
      c.id === 'd' ? { ...c, positions: [{ cols: 6 as const, x: 5, y: 0 }] } : c,
    )
    const saved = normalize(placed)
    expect(saved.every((c) => c.positions.length === 1 && c.positions[0]?.cols === 6)).toBe(true)
    expect(saved.find((c) => c.id === 'd')?.positions).toEqual([{ cols: 6, x: 5, y: 0 }])
  })
})
