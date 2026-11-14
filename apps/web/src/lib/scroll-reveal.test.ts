import { expect, test } from 'vitest'
import { scrollToReveal } from './scroll-reveal'

test('an item in view leaves the strip where it is', () => {
  expect(scrollToReveal({ start: 40, size: 300 }, { start: 100, size: 80 })).toBe(40)
})

test('an item cut off at either end is brought to the nearest edge', () => {
  expect(scrollToReveal({ start: 120, size: 300 }, { start: 100, size: 80 })).toBe(100)
  expect(scrollToReveal({ start: 0, size: 300 }, { start: 260, size: 80 })).toBe(40)
})

test('an item wider than the view shows its start', () => {
  expect(scrollToReveal({ start: 0, size: 100 }, { start: 50, size: 180 })).toBe(50)
})
