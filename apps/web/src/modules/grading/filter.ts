import type { Assessment } from '@semestra/api-client'
import { m } from '@/paraglide/messages'

/**
 * Which assessments the gradebook lists: all, the scored ones, or the ones without a score yet.
 * A past one without a score is waiting for its grade; a missed deadline is the to-do's to show.
 */
export type AssessmentFilter = 'all' | 'graded' | 'pending'

export const FILTERS: readonly AssessmentFilter[] = ['all', 'graded', 'pending']

export function filterLabel(filter: AssessmentFilter): string {
  switch (filter) {
    case 'all':
      return m.grading_filter_all()
    case 'graded':
      return m.grading_filter_graded()
    case 'pending':
      return m.grading_filter_pending()
  }
}

export function matchesFilter(a: Assessment, filter: AssessmentFilter, search: string): boolean {
  const query = search.trim().toLocaleLowerCase()
  if (query && !a.title.toLocaleLowerCase().includes(query)) return false
  return filter === 'all' || a.status === filter
}
