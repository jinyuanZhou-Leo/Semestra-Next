import type { Term } from '@semestra/api-client'
import { expect, test } from 'vitest'
import { termByDate } from './current-term'

const term = (id: string, start_date: string, is_current = false) =>
  ({ id, start_date, is_current }) as Term

test('the term the server marks current wins', () => {
  const terms = [term('a', '2025-09-01'), term('b', '2026-01-05', true), term('c', '2026-09-01')]
  expect(termByDate(terms, '2026-02-01')?.id).toBe('b')
})

test('between terms the next one to start is current, else the one that ended last', () => {
  const terms = [term('c', '2026-09-01'), term('a', '2025-09-01'), term('b', '2026-01-05')]
  expect(termByDate(terms, '2026-07-01')?.id).toBe('c')
  expect(termByDate(terms, '2026-12-31')?.id).toBe('c')
  expect(termByDate(terms.slice(1), '2026-07-01')?.id).toBe('b')
})

test('no terms, no current term', () => {
  expect(termByDate([], '2026-07-01')).toBeUndefined()
  expect(termByDate(undefined, '2026-07-01')).toBeUndefined()
})
