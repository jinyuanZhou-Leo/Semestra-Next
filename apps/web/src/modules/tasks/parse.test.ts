import type { Course } from '@semestra/api-client'
import { expect, test } from 'vitest'
import { readDates } from './dates'
import { readTitle, stripTokens } from './parse'

// A Thursday.
const NOW = new Date('2026-11-12T10:00:00')
const course = (id: string, code: string) => ({ id, code }) as Course
const COURSES = [course('c1', 'APS105H1'), course('m1', 'MAT135H1'), course('m5', 'MAT135H5')]

function read(text: string, locale = 'en') {
  const tokens = readTitle(text, {
    courses: COURSES,
    readDates: (t) => readDates(t, NOW, locale),
  })
  return { title: stripTokens(text, tokens), tokens }
}

test('reads an English date and time, a priority mark and a course code', () => {
  const { title, tokens } = read('Fri 5pm aps 105 lab report !!!')
  expect(title).toBe('lab report')
  expect(tokens).toMatchObject([
    { kind: 'date', text: 'Fri 5pm', due_date: '2026-11-13', due_time: '17:00' },
    { kind: 'course', text: 'aps 105', course_id: 'c1' },
    { kind: 'priority', text: '!!!', priority: 'high' },
  ])
})

test('reads Chinese, and takes the words out without leaving spaces between Chinese', () => {
  const { title, tokens } = read('明天下午3点交APS105H1作业 ！！', 'zh-CN')
  expect(title).toBe('交作业')
  expect(tokens).toMatchObject([
    { kind: 'date', due_date: '2026-11-13', due_time: '15:00' },
    { kind: 'course', course_id: 'c1' },
    { kind: 'priority', priority: 'medium' },
  ])
})

test('a date that runs into a course code stops before it', () => {
  expect(read('明天下午3点 APS105 作业', 'zh-CN')).toMatchObject({
    title: '作业',
    tokens: [{ kind: 'date', text: '明天下午3点', due_time: '15:00' }, { kind: 'course' }],
  })
})

test('a date without a time leaves the time empty', () => {
  expect(read('Read chapter 3 next Monday').tokens).toMatchObject([
    { kind: 'date', due_date: '2026-11-16', due_time: null },
  ])
})

test('a code that starts two courses names neither', () => {
  expect(read('MAT135 problem set').tokens).toEqual([])
  expect(read('MAT135H5 problem set').tokens).toMatchObject([{ course_id: 'm5' }])
})

test('a title with nothing else in it stays as typed', () => {
  expect(read('tomorrow').tokens).toEqual([])
  expect(read('Hello! world').tokens).toEqual([])
  expect(read('Read chapter 3').tokens).toEqual([])
})
