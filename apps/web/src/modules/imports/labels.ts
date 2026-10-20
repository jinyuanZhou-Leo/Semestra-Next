import type { ImportItem, ImportSession, ImportSessionDetail, Issue } from '@semestra/api-client'
import { errorMessage } from '@/lib/errors'
import { formatDate } from '@/lib/format'
import { weekdayName } from '@/modules/schedule/time'
import { m } from '@/paraglide/messages'
import type {
  AssessmentData,
  CategoryData,
  CourseData,
  EventData,
  ItemType,
  MeetingData,
  TaskData,
} from './types'

export const TYPE_LABELS: Record<ItemType, () => string> = {
  course: m.imports_type_course,
  course_patch: m.imports_type_course_patch,
  meeting: m.imports_type_meeting,
  event: m.imports_type_event,
  category: m.imports_type_category,
  assessment: m.imports_type_assessment,
  assessment_patch: m.imports_type_assessment_patch,
  task: m.imports_type_task,
  task_patch: m.imports_type_task_patch,
}

export function issueText(issue: Issue): string {
  return errorMessage({ error: { code: issue.code, params: issue.params ?? {} } })
}

function hm(value: string | undefined): string {
  return value ? value.slice(0, 5) : ''
}

/** One line naming the item in the review list. */
export function itemTitle(item: ImportItem): string {
  const data = item.data as Record<string, unknown>
  switch (item.type) {
    case 'course': {
      const c = data as CourseData
      return c.code ? `${c.code} · ${c.title}` : c.title
    }
    case 'course_patch':
      return m.imports_patch_title({ count: Object.keys((data.changes as object) ?? {}).length })
    case 'assessment_patch':
    case 'task_patch':
      return String(data.label ?? '')
    case 'meeting': {
      const mt = data as MeetingData
      return [mt.section_code || mt.type_code, weekdayName(mt.weekday, 'short')]
        .filter(Boolean)
        .join(' · ')
    }
    case 'category':
      return (data as CategoryData).name
    default:
      return String((data as AssessmentData | EventData | TaskData).title ?? '')
  }
}

/** The line under the title: when, how much. */
export function itemDetail(item: ImportItem): string {
  const data = item.data as Record<string, unknown>
  switch (item.type) {
    case 'meeting': {
      const mt = data as MeetingData
      const cancelled = mt.exceptions?.length
        ? m.imports_meeting_cancelled({ count: mt.exceptions.length })
        : null
      return [`${hm(mt.start_time)}–${hm(mt.end_time)}`, mt.location, cancelled]
        .filter(Boolean)
        .join(' · ')
    }
    case 'assessment': {
      const a = data as AssessmentData
      const when = a.due_date ? formatDate(a.due_date) : a.due_text
      return [a.weight != null ? `${a.weight}%` : null, when].filter(Boolean).join(' · ')
    }
    case 'category': {
      const c = data as CategoryData
      return c.weight_total != null ? `${c.weight_total}%` : ''
    }
    case 'event': {
      const e = data as EventData
      return e.date ? formatDate(e.date) : (e.date_text ?? '')
    }
    case 'task': {
      const t = data as TaskData
      return t.due_date ? formatDate(t.due_date) : (t.due_text ?? '')
    }
    case 'course': {
      const c = data as CourseData
      return (c.planned_terms ?? 1) > 1 ? m.imports_year_long() : ''
    }
    case 'assessment_patch':
    case 'task_patch':
      return m.imports_patch_title({ count: Object.keys((data.changes as object) ?? {}).length })
    default:
      return ''
  }
}

const ISSUE_SHORT: Record<string, (p: { count: number }) => string> = {
  'import.date_unresolved': m.imports_issue_dates,
  'import.weights_not_100': m.imports_issue_weights,
  'import.category_weight_mismatch': m.imports_issue_weights,
  'import.duplicate_course': m.imports_issue_duplicates,
  'import.duplicate_assessment': m.imports_issue_duplicates,
  'import.term_unresolved': m.imports_issue_terms,
  'import.outside_term': m.imports_issue_weeks,
  'import.no_teaching_weeks': m.imports_issue_weeks,
  'import.course_ref_missing': m.imports_issue_refs,
}

/** "3 dates to check · weights don't add up" for the accepted items, or null without issues. */
export function issueSummary(session: ImportSessionDetail): string | null {
  const counts = new Map<(p: { count: number }) => string, number>()
  for (const [code, count] of Object.entries(session.summary.issues ?? {})) {
    const fn = ISSUE_SHORT[code] ?? m.imports_issue_other
    counts.set(fn, (counts.get(fn) ?? 0) + count)
  }
  if (counts.size === 0) return null
  return [...counts].map(([fn, count]) => fn({ count })).join(' · ')
}

export const SOURCE_KIND_LABELS: Record<ImportSession['source_kind'], () => string> = {
  ics: m.imports_source_ics,
  syllabus: m.imports_source_syllabus,
  timetable_image: m.imports_source_timetable,
  text: m.imports_source_text,
  lms: m.imports_source_lms,
  agent: m.imports_source_agent,
}

export const STATUS_LABELS: Record<ImportSession['status'], () => string> = {
  extracting: m.imports_status_extracting,
  ready: m.imports_status_ready,
  committing: m.imports_status_committing,
  committed: m.imports_status_committed,
  failed: m.imports_status_failed,
  discarded: m.imports_status_discarded,
}
