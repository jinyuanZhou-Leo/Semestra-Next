import type { Course } from '@semestra/api-client'
import type { ReadDate } from './dates'
import type { Priority } from './types'

/** Words of a new task's title read as one of its properties (M05 §5.1). */
export type Token = { index: number; text: string } & (
  | { kind: 'date'; due_date: string; due_time: string | null }
  | { kind: 'priority'; priority: Priority }
  | { kind: 'course'; course_id: string }
)

export type TokenKind = Token['kind']

// As in Apple Reminders: one mark is low, two medium, three high.
const MARKS: Record<number, Priority> = { 1: 'low', 2: 'medium', 3: 'high' }
// Chinese puts no space before them, so two or three right after a character count too; one
// would read every "太好了！" as low priority.
const MARK = /(?<=^|\s)[!！]{1,3}(?=\s|$)|(?<=\p{Script=Han})[!！]{2,3}(?=\s|$)/gu
// A course code as typed: letters then digits, maybe a space between and a suffix ("APS105H1",
// "aps 105"), not inside a longer word. Chinese may follow it directly ("APS105作业").
const CODE = /(?<![A-Za-z0-9])[A-Za-z]{2,}\s?\d{2,}[A-Za-z0-9]*(?![A-Za-z0-9])/g

const key = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

/**
 * The course a word names: its whole code, or the start of exactly one course's code, so
 * "MAT135" names nothing when there are MAT135H1 and MAT135H5.
 */
function courseFor(word: string, courses: readonly Course[]): Course | undefined {
  const typed = key(word)
  const exact = courses.find((c) => c.code && key(c.code) === typed)
  if (exact) return exact
  const started = courses.filter((c) => c.code && key(c.code).startsWith(typed))
  return started.length === 1 ? started[0] : undefined
}

function overlaps(a: Pick<Token, 'index' | 'text'>, b: Pick<Token, 'index' | 'text'>) {
  return a.index < b.index + b.text.length && b.index < a.index + a.text.length
}

/**
 * Reads a new task's title like "Fri 5pm APS105 lab report !!!" or "明天下午3点 复习": the last
 * `!`/`!!`/`!!!`, the first course code of `courses`, and the first date clear of those (by
 * `readDates`, once it has loaded). A title that would be left empty keeps its words.
 */
export function readTitle(
  text: string,
  {
    courses,
    readDates,
  }: {
    /** The courses to look for; none when the course is fixed (a course's page). */
    courses: readonly Course[]
    readDates: ((text: string) => ReadDate[]) | null
  },
): Token[] {
  if (!text.trim()) return []
  const tokens: Token[] = []
  const mark = [...text.matchAll(MARK)].at(-1)
  if (mark) {
    tokens.push({
      kind: 'priority',
      index: mark.index,
      text: mark[0],
      priority: MARKS[mark[0].length]!,
    })
  }
  for (const found of text.matchAll(CODE)) {
    const course = courseFor(found[0], courses)
    if (!course) continue
    tokens.push({ kind: 'course', index: found.index, text: found[0], course_id: course.id })
    break
  }
  const date = readDates?.(text).find((d) => !tokens.some((t) => overlaps(t, d)))
  if (date) tokens.push({ kind: 'date', ...date })
  // "tomorrow" alone, or "!!" alone, stays the title.
  if (!stripTokens(text, tokens)) return []
  return tokens.toSorted((a, b) => a.index - b.index)
}

// Chinese and Japanese are written without spaces, so taking words out of "明天交作业" leaves none.
const UNSPACED = /[\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{P}]/u

/** The title without the given words, spaces tidied. */
export function stripTokens(text: string, tokens: readonly Pick<Token, 'index' | 'text'>[]) {
  let out = text
  for (const t of tokens.toSorted((a, b) => b.index - a.index)) {
    const before = out.slice(0, t.index)
    const after = out.slice(t.index + t.text.length)
    const joined = UNSPACED.test(before.at(-1) ?? ' ') || UNSPACED.test(after[0] ?? ' ')
    out = `${before}${joined ? '' : ' '}${after}`
  }
  return out.replace(/\s+/g, ' ').trim()
}
