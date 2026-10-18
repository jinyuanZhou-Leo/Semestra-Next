import { expect, test } from 'vitest'
import { applyEdit, currentValue, problemOf, ratio, stepped } from './counter'
import { counterSettingsSchema } from './schema'

const base = counterSettingsSchema.parse({})

test('the defaults form a valid counter from 0 to 10', () => {
  expect(base).toMatchObject({ label: '', min: 0, max: 10, step: 1, initial: 0, show_ring: true })
  expect(currentValue(base)).toBe(0)
})

test('stepping stops at both ends of the range', () => {
  const s = { ...base, min: 0, max: 10, step: 4, value: 8 }
  expect(stepped(s, 1)).toBe(10)
  expect(stepped({ ...s, value: 2 }, -1)).toBe(0)
  expect(stepped({ ...s, value: 5 }, 1)).toBe(9)
})

test('a stored value outside the range is shown inside it', () => {
  expect(currentValue({ ...base, value: 99 })).toBe(10)
  expect(currentValue({ ...base, value: -4 })).toBe(0)
})

test('the ring shows the position in the range', () => {
  expect(ratio({ ...base, min: 10, max: 20, value: 15 })).toBe(0.5)
})

test('the schema rejects an empty range and a start value outside it', () => {
  expect(counterSettingsSchema.safeParse({ min: 5, max: 5 }).success).toBe(false)
  expect(counterSettingsSchema.safeParse({ min: 0, max: 5, initial: 6 }).success).toBe(false)
  expect(counterSettingsSchema.safeParse({ step: 0 }).success).toBe(false)
  expect(counterSettingsSchema.safeParse({ step: 1.5 }).success).toBe(false)
})

test('problems are named for the form', () => {
  expect(problemOf({ min: 3, max: 3, step: 1, initial: 3 })).toBe('range')
  expect(problemOf({ min: 0, max: 3, step: 0, initial: 0 })).toBe('step')
  expect(problemOf({ min: 0, max: 3, step: 1, initial: 4 })).toBe('initial')
  expect(problemOf({ min: 0, max: 3, step: 1, initial: 2 })).toBeNull()
})

test('shrinking the range moves the count into it and says so', () => {
  const edited = applyEdit({ ...base, value: 9 }, { max: 5 })
  expect(edited.settings.value).toBe(5)
  expect(edited.clampedTo).toBe(5)
  expect(applyEdit({ ...base, value: 3 }, { max: 5 }).clampedTo).toBeNull()
  // An invalid edit is kept for the form to show, and leaves the count alone.
  const invalid = applyEdit({ ...base, value: 9 }, { min: 20 })
  expect(invalid.settings.value).toBe(9)
  expect(invalid.clampedTo).toBeNull()
})
