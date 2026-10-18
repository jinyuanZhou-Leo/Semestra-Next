import { expect, test } from 'vitest'
import { jobStageLabel } from './use-job'

const job = {
  kind: 'template.countdown',
  step: 'counting',
  step_current: null,
  step_total: null,
  attempts: 1,
}

test('stage labels come from job_step_<kind>_<step>, with counts and a retry prefix', () => {
  expect(jobStageLabel(job)).toBe('Counting')
  expect(jobStageLabel({ ...job, step_current: 3, step_total: 12 })).toBe('Counting 3/12')
  expect(jobStageLabel({ ...job, attempts: 2 })).toBe('Retrying · Counting')
  expect(jobStageLabel({ ...job, step: 'unknown' })).toBe('Working…')
  expect(jobStageLabel({ ...job, step: null })).toBe('Working…')
})
