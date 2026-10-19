import { expect, test } from 'vitest'
import { parseQuickAdd } from './parse'

// Wednesday 14 January 2026, 10:00.
const NOW = new Date(2026, 0, 14, 10, 0)

test('reads a Chinese date, time and title', () => {
  const r = parseQuickAdd('明天下午3点 复习', NOW, 'zh-CN')
  expect(r).toMatchObject({ title: '复习', dueDate: '2026-01-15', dueTime: '15:00' })
})

test('reads an English weekday, time and priority marks', () => {
  const r = parseQuickAdd('Fri 5pm essay !!!', NOW, 'en')
  expect(r).toMatchObject({
    title: 'essay',
    dueDate: '2026-01-16',
    dueTime: '17:00',
    priority: 'urgent',
    priorityText: '!!!',
  })
})

test('two marks mean high priority, as in "周五 lab 报告 !!"', () => {
  const r = parseQuickAdd('周五 lab 报告 !!', NOW, 'zh-CN')
  expect(r).toMatchObject({ title: 'lab 报告', dueDate: '2026-01-16', priority: 'high' })
})

test('a date alone has no time; text without a date stays whole', () => {
  expect(parseQuickAdd('submit report tomorrow', NOW, 'en')).toMatchObject({
    title: 'submit report',
    dueDate: '2026-01-15',
    dueTime: null,
  })
  expect(parseQuickAdd('Read chapter 3', NOW, 'en')).toMatchObject({
    title: 'Read chapter 3',
    dueDate: null,
    priority: null,
  })
})

test('a line that is only a date is kept as the title', () => {
  expect(parseQuickAdd('tomorrow', NOW, 'en')).toMatchObject({ title: 'tomorrow', dueDate: null })
})

test('an exclamation inside a word is not a priority', () => {
  expect(parseQuickAdd('Hello! world', NOW, 'en')).toMatchObject({
    title: 'Hello! world',
    priority: null,
  })
})

test('undoing the date or the priority puts the words back', () => {
  const kept = parseQuickAdd('Fri 5pm essay !!', NOW, 'en', {
    ignoreDate: true,
    ignorePriority: true,
  })
  expect(kept).toMatchObject({ title: 'Fri 5pm essay !!', dueDate: null, priority: null })
  expect(kept.dateText).toBe('Fri 5pm')
  expect(kept.priorityText).toBe('!!')
})
