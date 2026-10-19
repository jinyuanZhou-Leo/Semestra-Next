import * as chrono from 'chrono-node'
import type { Priority } from './types'

export type QuickAdd = {
  /** What is left of the text once the date and the priority mark are taken out. */
  title: string
  dueDate: string | null
  dueTime: string | null
  priority: Priority | null
  /** The words that were read as a date and the mark that was read as a priority. */
  dateText: string | null
  priorityText: string | null
}

// As in Apple Reminders: one mark is low, two medium, three high.
const PRIORITY_MARKS: Record<number, Priority> = { 1: 'low', 2: 'medium', 3: 'high' }
const MARK = /(^|\s)([!！]{1,3})(?=\s|$)/g

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function parserFor(locale: string) {
  const zh = chrono.zh.hans
  return locale.startsWith('zh') ? [zh, chrono.casual] : [chrono.casual, zh]
}

function cut(text: string, index: number, length: number): string {
  return `${text.slice(0, index)} ${text.slice(index + length)}`.replace(/\s+/g, ' ').trim()
}

/**
 * Reads a quick-add line like "Fri 5pm essay !!" or "明天下午3点 复习": a date and time in
 * Chinese or English, and a trailing `!`/`!!`/`!!!` for low/medium/high. The words that
 * were understood are removed from the title; the caller shows them as chips that can be undone.
 */
export function parseQuickAdd(
  input: string,
  now: Date,
  locale: string,
  { ignoreDate = false, ignorePriority = false } = {},
): QuickAdd {
  let text = input.trim()
  let priority: Priority | null = null
  let priorityText: string | null = null
  const marks = [...text.matchAll(MARK)]
  const last = marks.at(-1)
  if (last?.[2]) {
    priorityText = last[2]
    priority = PRIORITY_MARKS[priorityText.length] ?? null
    if (!ignorePriority) text = cut(text, last.index + last[1]!.length, priorityText.length)
    else priority = null
  }
  let dueDate: string | null = null
  let dueTime: string | null = null
  let dateText: string | null = null
  for (const parser of parserFor(locale)) {
    const found = parser.parse(text, now, { forwardDate: true })[0]
    if (!found) continue
    const rest = cut(text, found.index, found.text.length)
    if (!rest) continue // the whole line is a date: keep it as the title
    dateText = found.text
    if (!ignoreDate) {
      const start = found.start
      dueDate = `${start.get('year')}-${pad(start.get('month') ?? 1)}-${pad(start.get('day') ?? 1)}`
      if (start.isCertain('hour')) {
        dueTime = `${pad(start.get('hour') ?? 0)}:${pad(start.get('minute') ?? 0)}`
      }
      text = rest
    }
    break
  }
  return { title: text, dueDate, dueTime, priority, dateText, priorityText }
}
