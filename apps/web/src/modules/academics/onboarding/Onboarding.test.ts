import { afterEach, expect, test } from 'vitest'
import { onboardingInProgress } from './Onboarding'

afterEach(() => sessionStorage.clear())

test('onboarding progress belongs to the user who started it', () => {
  sessionStorage.setItem('semestra.onboarding', JSON.stringify({ userId: 'a', step: 2 }))
  expect(onboardingInProgress('a')).toBe(true)
  expect(onboardingInProgress('b')).toBe(false)
})
