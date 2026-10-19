import { expect, test } from 'vitest'
import {
  formatZoneDate,
  formatZoneTime,
  isValidZone,
  offsetFrom,
  offsetMinutes,
  searchZones,
  zoneLabel,
} from './zones'

// 2026-01-15 12:00 UTC: winter time in the northern hemisphere.
const noon = new Date('2026-01-15T12:00:00Z')

test('cities are found by English and Chinese names', () => {
  expect(searchZones('toro', 'en')[0]).toEqual({ tz: 'America/Toronto', label: 'Toronto' })
  expect(searchZones('东京', 'zh-CN')[0]).toEqual({ tz: 'Asia/Tokyo', label: '东京' })
  expect(searchZones('new york', 'zh-CN')[0]).toEqual({ tz: 'America/New_York', label: '纽约' })
})

test('zones outside the curated list are found by the city in their id', () => {
  const result = searchZones('Reg', 'en').map((z) => z.tz)
  expect(result).toContain('America/Regina')
  expect(zoneLabel('America/Regina', 'en')).toBe('Regina')
  expect(searchZones('', 'en')).toEqual([])
})

test('offsets include half-hour zones and follow daylight saving time', () => {
  expect(offsetMinutes(noon, 'Asia/Kolkata')).toBe(330)
  expect(offsetMinutes(noon, 'America/Toronto')).toBe(-300)
  expect(offsetMinutes(new Date('2026-07-15T12:00:00Z'), 'America/Toronto')).toBe(-240)
  expect(offsetMinutes(noon, 'UTC')).toBe(0)
  expect(offsetFrom(noon, 'Asia/Tokyo', 'America/Toronto')).toBe(14 * 60)
})

test('time and date are formatted in the zone', () => {
  expect(formatZoneTime(noon, 'Asia/Tokyo', 'en-US')).toMatch(/9:00\s?PM/)
  expect(formatZoneTime(noon, 'Asia/Tokyo', 'en-US', { seconds: true })).toMatch(/9:00:00/)
  expect(formatZoneDate(noon, 'Asia/Tokyo', 'en-US')).toContain('Thu')
})

test('invalid zones are rejected', () => {
  expect(isValidZone('Asia/Tokyo')).toBe(true)
  expect(isValidZone('Mars/Olympus')).toBe(false)
})
