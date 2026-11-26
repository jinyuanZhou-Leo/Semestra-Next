import type { Assessment } from '@semestra/api-client'
import { m } from '@/paraglide/messages'
import type { Progress } from './types'

/**
 * Which assessments the gradebook lists (M03 §5.1): all, the ones still to do, the ones handed in
 * and waiting for a grade, or the graded ones; the same four as the Canvas tab's (M16 §4).
 */
export type AssessmentFilter = 'all' | Progress

export const FILTERS: readonly AssessmentFilter[] = ['all', 'todo', 'awaiting', 'graded']

export function filterLabel(filter: AssessmentFilter): string {
  switch (filter) {
    case 'all':
      return m.grading_filter_all()
    case 'todo':
      return m.grading_filter_todo()
    case 'awaiting':
      return m.grading_filter_awaiting()
    case 'graded':
      return m.grading_filter_graded()
  }
}

/**
 * Where the user is with an assessment: graded once it has a score, and only then; else as the
 * platform it comes from says (`platform`, undefined when it is not known; null: in no filter,
 * e.g. excused), where a grade the gradebook doesn't have yet (not followed, or waiting for the
 * user's answer) is still awaited; else by its due date: to do until then (or without one),
 * waiting for a grade after.
 */
export function progressOf(
  a: Assessment,
  platform: Progress | null | undefined,
  now: number,
): Progress | null {
  if (a.status === 'graded') return 'graded'
  if (platform === 'graded') return 'awaiting'
  if (platform !== undefined) return platform
  return a.due_at === null || Date.parse(a.due_at) > now ? 'todo' : 'awaiting'
}

export function matchesSearch(a: Assessment, search: string): boolean {
  const query = search.trim().toLocaleLowerCase()
  return !query || a.title.toLocaleLowerCase().includes(query)
}
