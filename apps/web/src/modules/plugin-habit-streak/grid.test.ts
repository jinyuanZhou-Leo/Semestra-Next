import { expect, test } from 'vitest'
import { addDays, columnsRange, milestoneAt, weekColumns, weekStartOf } from './grid'

// 2026-01-15 is a Thursday.
test('dates move across month and year ends', () => {
  expect(addDays('2026-01-31', 1)).toBe('2026-02-01')
  expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
  expect(addDays('2024-02-28', 2)).toBe('2024-03-01')
})

test('weeks start on Monday or Sunday', () => {
  expect(weekStartOf('2026-01-15', 1)).toBe('2026-01-12')
  expect(weekStartOf('2026-01-15', 7)).toBe('2026-01-11')
  expect(weekStartOf('2026-01-11', 1)).toBe('2026-01-05')
  expect(weekStartOf('2026-01-11', 7)).toBe('2026-01-11')
})

test('the board shows N whole weeks ending with the current one, future days marked', () => {
  const columns = weekColumns('2026-01-15', 1, 5)
  expect(columns).toHaveLength(5)
  expect(columns.every((week) => week.length === 7)).toBe(true)
  expect(columns[0]?.[0]?.date).toBe('2025-12-15')
  expect(columns[4]?.[0]?.date).toBe('2026-01-12')
  expect(columns[4]?.map((c) => c.future)).toEqual([false, false, false, false, true, true, true])
  expect(columnsRange('2026-01-15', 1, 5)).toEqual({ from: '2025-12-15', to: '2026-01-18' })
})

test('milestones are 7, 30 and 100 days', () => {
  expect([6, 7, 8, 30, 99, 100, 101].map(milestoneAt)).toEqual([null, 7, null, 30, null, 100, null])
})
