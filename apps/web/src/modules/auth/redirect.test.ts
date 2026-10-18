import { expect, test } from 'vitest'
import { deviceLabel } from '@/lib/device'
import { suggestEmails } from '@/lib/email-domains'
import { safeRedirect } from './redirect'

test('safeRedirect only allows same-origin paths', () => {
  expect(safeRedirect('/p/1?x=2')).toBe('/p/1?x=2')
  expect(safeRedirect(undefined)).toBe('/')
  expect(safeRedirect('https://evil.example')).toBe('/')
  expect(safeRedirect('//evil.example')).toBe('/')
  expect(safeRedirect('/\\evil.example')).toBe('/')
})

test('suggestEmails completes the domain after the @', () => {
  expect(suggestEmails('a@')).toContain('a@gmail.com')
  expect(suggestEmails('a@mail.u')).toEqual(['a@mail.utoronto.ca'])
  expect(suggestEmails('a@gmail.com')).toEqual([])
  expect(suggestEmails('no-at-sign')).toEqual([])
})

test('deviceLabel summarizes a user agent', () => {
  expect(
    deviceLabel(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
    ),
  ).toBe('Chrome · macOS')
  expect(deviceLabel(null)).toBeNull()
})
