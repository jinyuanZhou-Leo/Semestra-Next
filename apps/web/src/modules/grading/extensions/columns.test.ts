import type { Course } from '@semestra/api-client'
import { expect, test } from 'vitest'
import { courseColumns } from './columns'

const gpa = courseColumns.find((c) => c.id === 'grading.gpa')
const course = { id: 'c1' } as Course
const data = (hide: boolean) => ({
  hide_gpa: hide,
  max_points: 4,
  items: [{ course_id: 'c1', points: 4 }],
})

test('GPA ordering and threshold filters work on the numbers when GPA is shown', () => {
  expect(gpa?.sortValue?.(course, data(false))).toBe(4)
  expect(gpa?.filter?.every((f) => f.test(course, data(false)))).toBe(true)
})

test('hidden GPA gives no ordering and matches no threshold filter', () => {
  expect(gpa?.sortValue?.(course, data(true))).toBeNull()
  expect(gpa?.filter?.some((f) => f.test(course, data(true)))).toBe(false)
})
