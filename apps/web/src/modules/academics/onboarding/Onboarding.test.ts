import { afterEach, expect, test } from 'vitest'
import { onboardingInProgress } from './progress'

afterEach(() => sessionStorage.clear())

test('onboarding progress belongs to the user who started it', () => {
  sessionStorage.setItem(
    'semestra.onboarding',
    JSON.stringify({ userId: 'a', stage: { kind: 'term', programId: 'p' } }),
  )
  expect(onboardingInProgress('a')).toBe(true)
  expect(onboardingInProgress('b')).toBe(false)
})
