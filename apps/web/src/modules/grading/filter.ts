import type { Assessment } from '@semestra/api-client'
import { m } from '@/paraglide/messages'

/** Which assessments the gradebook lists: all, the scored ones, the ones still to come, or late. */
export type AssessmentFilter = 'all' | 'graded' | 'pending' | 'overdue'

export const FILTERS: readonly AssessmentFilter[] = ['all', 'graded', 'pending', 'overdue']

export function filterLabel(filter: AssessmentFilter): string {
  switch (filter) {
    case 'all':
      return m.grading_filter_all()
    case 'graded':
      return m.grading_filter_graded()
    case 'pending':
      return m.grading_filter_pending()
    case 'overdue':
      return m.grading_filter_overdue()
  }
}

/** "Pending" includes overdue items: neither has a score yet. */
export function matchesFilter(a: Assessment, filter: AssessmentFilter, search: string): boolean {
  const query = search.trim().toLocaleLowerCase()
  if (query && !a.title.toLocaleLowerCase().includes(query)) return false
  if (filter === 'all') return true
  if (filter === 'pending') return a.status !== 'graded'
  return a.status === filter
}
