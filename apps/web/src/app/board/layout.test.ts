import { describe, expect, test } from 'vitest'
import { compact, firstFree, type LayoutItem, moveItem, resizeItem, rows } from './layout'

const at = (items: LayoutItem[]) =>
  Object.fromEntries(items.map((i) => [i.id, [i.size, i.x, i.y].join(' ')]))

describe('compact', () => {
  test('moves cards up and keeps their column', () => {
    const items: LayoutItem[] = [
      { id: 'a', size: 'm', x: 0, y: 3 },
      { id: 'b', size: 's', x: 3, y: 5 },
      { id: 'c', size: 'xl', x: 0, y: 6 },
    ]
    expect(at(compact(items))).toEqual({ a: 'm 0 0', b: 's 3 0', c: 'xl 0 1' })
  })

  test('resolves overlaps by pushing later cards down and clamps to 4 columns', () => {
    const items: LayoutItem[] = [
      { id: 'a', size: 'l', x: 0, y: 0 },
      { id: 'b', size: 'm', x: 1, y: 1 },
      { id: 'c', size: 'm', x: 3, y: 0 },
    ]
    expect(at(compact(items))).toEqual({ a: 'l 0 0', c: 'm 2 0', b: 'm 1 2' })
  })
})

test('first free spot is top-most, then left-most', () => {
  const items: LayoutItem[] = [
    { id: 'a', size: 'm', x: 0, y: 0 },
    { id: 'b', size: 's', x: 3, y: 0 },
  ]
  expect(firstFree(items, 's')).toEqual({ x: 2, y: 0 })
  expect(firstFree(items, 'm')).toEqual({ x: 0, y: 1 })
  expect(firstFree([], 'xl')).toEqual({ x: 0, y: 0 })
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
