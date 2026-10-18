import { expect, test } from 'vitest'
import { formatBytes, formatCredits, formatGpa, formatPercent, formatTime } from './format'

test('formats numbers for the current locale (en in tests)', () => {
  expect(formatPercent(0.875)).toBe('87.5%')
  expect(formatGpa(3.8)).toBe('3.80')
  expect(formatCredits(0.5)).toBe('0.5')
  expect(formatBytes(52_428_800)).toBe('50 MB')
  expect(formatBytes(512)).toBe('512 byte')
  expect(formatTime('14:05', { hour12: false })).toBe('14:05')
  expect(formatTime('14:05', { hour12: true })).toBe('2:05 PM')
})
