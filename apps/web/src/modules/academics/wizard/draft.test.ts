import { expect, test } from 'vitest'
import { NEXT_TERM, rangeOf, rangeTerms, spanFrom } from '../term-range'
import { course, term } from '../test-data'
import { continuationCandidates, suggestTermName } from './draft'

test('term names are suggested from the start date', () => {
  expect(suggestTermName('2026-09-08')).toBe('Fall 2026')
  expect(suggestTermName('2027-01-06')).toBe('Winter 2027')
  expect(suggestTermName('2027-02-20')).toBe('Spring 2027')
  expect(suggestTermName('2027-05-10')).toBe('Summer 2027')
  expect(suggestTermName('')).toBe('')
})

const fall = term({ id: 'fall', start_date: '2025-09-04', end_date: '2025-12-20' })
const winter = term({ id: 'winter', start_date: '2026-01-06', end_date: '2026-04-30' })

test('year-long courses of the previous term wait to be continued', () => {
  const waiting = course({ id: 'y', term_ids: ['fall'], planned_terms: 2 })
  const finished = course({ id: 'f', term_ids: ['fall'] })
  const older = course({ id: 'o', term_ids: ['fall'], planned_terms: 2 })
  // A term starting after Winter: only courses that ended in Winter qualify.
  expect(continuationCandidates([fall, winter], [older], '2026-05-10')).toEqual([])
  expect(continuationCandidates([fall], [waiting, finished], '2026-01-06')).toEqual([waiting])
  expect(continuationCandidates([], [waiting], '2026-01-06')).toEqual([])
})

test('a course spans one run of terms', () => {
  const summer = term({ id: 'summer', start_date: '2026-05-10', end_date: '2026-08-14' })
  const all = [fall, winter, summer]
  expect(rangeOf(all, ['winter', 'fall'], 2)).toEqual({
    start: 'fall',
    end: 'winter',
    spanning: true,
  })
  expect(rangeOf(all, ['summer'], 2)).toEqual({ start: 'summer', end: NEXT_TERM, spanning: true })
  expect(spanFrom(all, 'winter', 'fall')).toEqual({ start: 'winter', end: 'summer' })
  expect(spanFrom(all, 'summer', 'fall')).toEqual({ start: 'summer', end: NEXT_TERM })
  expect(rangeTerms(all, { start: 'fall', end: 'summer' })).toEqual({
    term_ids: ['fall', 'winter', 'summer'],
    planned_terms: 3,
  })
  expect(rangeTerms(all, { start: 'summer', end: NEXT_TERM })).toEqual({
    term_ids: ['summer'],
    planned_terms: 2,
  })
})
