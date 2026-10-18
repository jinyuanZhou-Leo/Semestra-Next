import { expect, test } from 'vitest'
import { smoothedProgressTarget } from './smoothed-progress'

test('holds the real value until progress stalls, then creeps within budget', () => {
  expect(smoothedProgressTarget(40, 1_000)).toBe(40)
  expect(smoothedProgressTarget(40, 12_000)).toBeCloseTo(43.75)
  expect(smoothedProgressTarget(40, 60_000)).toBe(45)
  expect(smoothedProgressTarget(93, 60_000)).toBe(95)
  expect(smoothedProgressTarget(97, 60_000)).toBe(97)
  expect(smoothedProgressTarget(140, 0)).toBe(100)
})
