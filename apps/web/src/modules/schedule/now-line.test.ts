import type { Occurrence } from '@semestra/api-client'
import { describe, expect, it } from 'vitest'
import { nowLine } from './now-line'

const at = (h: number) => Date.UTC(2026, 10, 24, h)
const item = (id: string, from: number, to: number, all_day = false) =>
  ({
    id,
    start_at: new Date(at(from)).toISOString(),
    end_at: new Date(at(to)).toISOString(),
    all_day,
  }) as Occurrence
const day = [item('a', 10, 11), item('b', 12, 13), item('c', 14, 17)]

describe('nowLine', () => {
  it('sits inside the class in progress, in proportion to its length', () => {
    expect(nowLine(day, at(15) + 30 * 60_000)).toEqual([{ index: 2, at: 0.5 }])
  })
  it('sits at the top of the next timed item between classes', () => {
    expect(nowLine(day, at(13) + 30 * 60_000)).toEqual([{ index: 2, at: 0 }])
  })
  it('sits at the bottom of the last item once all are over', () => {
    expect(nowLine(day, at(20))).toEqual([{ index: 2, at: 1 }])
  })
  it('skips a cancelled class in progress', () => {
    const cancelled = [
      { ...item('a', 10, 11), status: 'cancelled' } as Occurrence,
      item('b', 12, 13),
    ]
    expect(nowLine(cancelled, at(10) + 30 * 60_000)).toEqual([{ index: 1, at: 0 }])
  })
  it('gives each of two overlapping classes a line', () => {
    const both = [item('a', 10, 12), item('b', 11, 13)]
    expect(nowLine(both, at(11) + 30 * 60_000)).toEqual([
      { index: 0, at: 0.75 },
      { index: 1, at: 0.25 },
    ])
  })
  it('is absent when everything is all-day', () => {
    expect(nowLine([item('x', 0, 23, true)], at(9))).toEqual([])
  })
})
