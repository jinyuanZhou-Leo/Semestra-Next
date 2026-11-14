import type { ImportItem, ImportSession, Issue } from '@semestra/api-client'
import { errorMessage } from '@/lib/errors'
import { formatDate } from '@/lib/format'
import { weekdayName } from '@/modules/schedule/time'
import { m } from '@/paraglide/messages'
import { FIELDS } from './fields'
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
  task: m.imports_type_task,
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

function dateTime(date: string | undefined, time: string | undefined): string {
  return date ? [formatDate(date), hm(time)].filter(Boolean).join(' ') : ''
}

/** The review's "when" cell: a due date, a meeting's hours, an event's day. */
export function itemWhen(item: ImportItem): string {
  const data = item.data as Record<string, unknown>
  switch (item.type) {
    case 'meeting': {
      const mt = data as MeetingData
      const cancelled = mt.exceptions?.length
        ? m.imports_meeting_cancelled({ count: mt.exceptions.length })
        : null
      return [`${hm(mt.start_time)}–${hm(mt.end_time)}`, cancelled].filter(Boolean).join(' · ')
    }
    case 'assessment':
    case 'task': {
      const a = data as AssessmentData | TaskData
      return dateTime(a.due_date, a.due_time)
    }
    case 'event': {
      const e = data as EventData
      return dateTime(e.date, e.all_day ? undefined : e.start_time)
    }
    case 'course': {
      const c = data as CourseData
      return (c.planned_terms ?? 1) > 1 ? m.imports_year_long() : ''
    }
    case 'course_patch':
      return m.imports_patch_title({ count: Object.keys((data.changes as object) ?? {}).length })
    default:
      return ''
  }
}

/** The review's weight cell: an assessment's share of the grade, a category's total. */
export function itemWeight(item: ImportItem): number | null {
  if (item.type === 'assessment') return (item.data as AssessmentData).weight ?? null
  if (item.type === 'category') return (item.data as CategoryData).weight_total ?? null
  return null
}

/**
 * Issues that record a choice already made (an assignment bound to the gradebook's assessment of
 * its title): they keep the import in review, where the row shows the choice, not a problem.
 */
export const SETTLED = new Set(['import.binds_assessment'])

/** What the review shows of an item: its editor's fields, or the fields a change sets. */
function shownFields(item: ImportItem): readonly string[] {
  if (item.type.endsWith('_patch')) {
    return Object.keys((item.data as { changes?: Record<string, unknown> }).changes ?? {})
  }
  return (FIELDS[item.type as keyof typeof FIELDS] ?? []).map((spec) => spec.key)
}

/**
 * The values to check (M08 §6.2): fields the review shows that were read with less than high
 * confidence, of those given (all shown when omitted). The one rule behind the footer's count,
 * the marks in the table and the editor, and "Looks right", so checking them all ends at zero.
 */
export function unsureFields(item: ImportItem, among?: readonly string[]): string[] {
  const shown = shownFields(item)
  return Object.entries(item.confidence)
    .filter(
      ([field, level]) =>
        level !== 'high' && shown.includes(field) && (!among || among.includes(field)),
    )
    .map(([field]) => field)
}

/**
 * An item to look at before importing: one of its values was read uncertainly, or it has an open
 * issue (a date to pick, a duplicate). Unticked items are not imported, so they need nothing.
 */
export function needsCheck(item: ImportItem): boolean {
  if (item.decision !== 'accept' || item.result) return false
  return unsureFields(item).length > 0 || item.issues.some((issue) => !SETTLED.has(issue.code))
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
  waiting_files: m.imports_status_waiting_files,
  ready: m.imports_status_ready,
  committing: m.imports_status_committing,
  committed: m.imports_status_committed,
  up_to_date: m.imports_status_up_to_date,
  failed: m.imports_status_failed,
  discarded: m.imports_status_discarded,
}
