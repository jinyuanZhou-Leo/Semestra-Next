import { expect, test } from 'vitest'
import {
  formatBytes,
  formatCredits,
  formatDate,
  formatGpa,
  formatPercent,
  formatTime,
  formatTimeAgo,
} from './format'

test('formats numbers for the current locale (en in tests)', () => {
  expect(formatPercent(0.875)).toBe('87.5%')
  expect(formatGpa(3.8)).toBe('3.80')
  expect(formatCredits(0.5)).toBe('0.5')
  expect(formatBytes(52_428_800)).toBe('50 MB')
  expect(formatBytes(512)).toBe('512 byte')
  expect(formatTime('14:05', { hour12: false })).toBe('14:05')
  expect(formatTime('14:05', { hour12: true })).toBe('2:05 PM')
})

test('a date without a time keeps its own day in every time zone', () => {
  expect(formatDate('2026-01-15')).toBe('Jan 15, 2026')
})

test('a past moment reads in its largest whole unit', () => {
  const now = Date.parse('2026-10-26T12:00:00Z')
  expect(formatTimeAgo('2026-10-26T11:59:30Z', now)).toBe('now')
  expect(formatTimeAgo('2026-10-26T11:55:00Z', now)).toBe('5 minutes ago')
  expect(formatTimeAgo('2026-10-26T10:30:00Z', now)).toBe('1 hour ago')
  expect(formatTimeAgo('2026-10-25T09:00:00Z', now)).toBe('yesterday')
})
