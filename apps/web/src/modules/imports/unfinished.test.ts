import type { ImportSession } from '@semestra/api-client'
import { expect, test } from 'vitest'
import { matchesKey, wizardTarget } from './unfinished'

const autumn = { startDate: '2026-09-08', endDate: '2026-12-22' }
const autumnDates = { start_date: '2026-09-08', end_date: '2026-12-22' }

function wizardSession(target: Omit<ImportSession['target'], 'kind'>): ImportSession {
  return {
    source_kind: 'syllabus',
    source_meta: {},
    target: { kind: 'term_wizard', ...target },
  } as ImportSession
}

test("a term wizard picks up only its own term's import", () => {
  const key = { source: 'syllabus' as const, target: wizardTarget(autumn) }
  const winter = wizardSession({ start_date: '2027-01-05', end_date: '2027-04-20' })
  const existing = wizardSession({ term_id: 't1', ...autumnDates })
  expect(matchesKey(wizardSession(autumnDates), key)).toBe(true)
  expect(matchesKey(winter, key)).toBe(false)
  // "Add course" on a term that exists is another wizard than creating one with those dates.
  expect(matchesKey(existing, key)).toBe(false)
  const ofTerm = { ...key, target: wizardTarget({ ...autumn, termId: 't1' }) }
  expect(matchesKey(existing, ofTerm)).toBe(true)
})
