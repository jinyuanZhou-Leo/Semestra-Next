import { expect, test } from 'vitest'
import { subjectColor } from './subject-color'

test('maps palette slots to tokens and keeps valid custom colors', () => {
  expect(subjectColor('subject-3')).toBe('var(--subject-3)')
  expect(subjectColor('#12abEF')).toBe('#12abEF')
  for (const bad of ['subject-13', 'subject-0', '#fff', 'red', null, undefined]) {
    expect(subjectColor(bad)).toBe('var(--subject-1)')
  }
})
