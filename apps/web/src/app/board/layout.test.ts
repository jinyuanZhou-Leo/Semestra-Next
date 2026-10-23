import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import type { CardSize } from '../extensions'
import { compact, firstFree, type LayoutItem, moveItem, resizeItem, rows } from './layout'

const at = (items: LayoutItem[]) =>
  Object.fromEntries(items.map((i) => [i.id, [i.size, i.x, i.y].join(' ')]))

type Row = [id: string, size: CardSize, x: number, y: number]
type Cases = {
  compact: { name: string; cards: Row[]; expected: Row[] }[]
  first_free: { name: string; cards: Row[]; sizes: Record<CardSize, [number, number]> }[]
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
  test.each(cases.compact)('$name', ({ cards, expected }) => {
    expect(compact(toItems(cards))).toEqual(toItems(expected))
  })
})

describe('first free spot', () => {
  test.each(cases.first_free)('$name', ({ cards, sizes }) => {
    for (const [size, [x, y]] of Object.entries(sizes)) {
      expect(firstFree(toItems(cards), size as CardSize)).toEqual({ x, y })
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
    expect(rows(resized)).toBe(4)
  })
})
