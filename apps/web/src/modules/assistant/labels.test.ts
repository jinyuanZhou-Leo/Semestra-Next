import { expect, test } from 'vitest'
import { fieldLabel, formatValue, plainArgs } from './labels'

test('accept and reject read as decisions only in the decision field', () => {
  expect(formatValue('accept', 'decision')).toBe('Keep')
  expect(formatValue('accept', 'title')).toBe('accept')
})

test('dates read in the UI format, ranges as one range', () => {
  expect(formatValue('2026-09-07')).toBe('Sep 7, 2026')
  // Intl puts thin spaces around the dash.
  expect(
    formatValue({ name: 'Fall 2026', start_date: '2026-09-07', end_date: '2026-12-31' }),
  ).toMatch(/^Fall 2026 \(Sep 7\s–\sDec 31, 2026\)$/u)
})

test('paging arguments stay off the list and common arguments have names', () => {
  expect(plainArgs({ query: 'lab', page_from: 1, page_to: 4, limit: 20, cursor: 'x' })).toEqual([
    ['query', 'lab'],
  ])
  expect(fieldLabel('query')).toBe('Search')
})
