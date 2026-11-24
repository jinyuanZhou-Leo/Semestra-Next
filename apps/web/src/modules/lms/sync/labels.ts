import type { SyncItem, SyncStatus, SyncUnreadable } from '@semestra/api-client'
import { isSameDay } from 'date-fns'
import { formatDate, formatPercent, formatTime } from '@/lib/format'
import { m } from '@/paraglide/messages'

/** The values the sync compares, in the forms the API gives them (M09 §4.1). */
type Due = { date: string; time: string | null }
type Score = { points_earned?: number; points_possible?: number; score_percentage?: number }

const FIELDS: Record<string, () => string> = {
  title: () => m.lms_sync_field_title(),
  due_at: () => m.lms_sync_field_due_at(),
  weight: () => m.lms_sync_field_weight(),
  score: () => m.lms_sync_field_score(),
  feedback: () => m.lms_sync_field_feedback(),
}

export function fieldLabel(field: string): string {
  return FIELDS[field]?.() ?? field
}

/** A field's value as the panel shows it: "Nov 20 23:59", "20%", "18/20", or a dash. */
export function formatValue(field: string, value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (field === 'due_at') {
    const due = value as Due
    const day = formatDate(due.date, { short: true })
    return due.time ? `${day} ${formatTime(new Date(`${due.date}T${due.time}`))}` : day
  }
  if (field === 'weight') return formatPercent(Number(value) / 100)
  if (field === 'score') {
    const score = value as Score
    if (score.points_earned != null && score.points_possible) {
      return `${score.points_earned}/${score.points_possible}`
    }
    return score.score_percentage != null ? formatPercent(score.score_percentage / 100) : '—'
  }
  return String(value)
}

/**
 * How many answers wait: one per field asked about, one per removed or new item (what the sync
 * counts, M09 §4.1).
 */
export function pendingCount(items: readonly SyncItem[]): number {
  return items.reduce(
    (n, item) => n + (item.kind === 'conflict' ? (item.conflicts ?? []).length : 1),
    0,
  )
}

/** Rows grouped by course, groups in the order their first row comes. */
export function byCourse<T extends { course_id: string; course: string }>(
  rows: readonly T[],
): { courseId: string; course: string; items: T[] }[] {
  const groups = new Map<string, T[]>()
  for (const row of rows) groups.set(row.course_id, [...(groups.get(row.course_id) ?? []), row])
  return [...groups].map(([courseId, items]) => ({
    courseId,
    course: items[0]?.course ?? '',
    items,
  }))
}

/** The parts of a course the sync reads (M09 表 5c), by name. */
const PARTS: Record<string, () => string> = {
  course: () => m.lms_part_course(),
  assignments: () => m.lms_area_assignments(),
  submissions: () => m.lms_part_submissions(),
  quizzes: () => m.lms_part_quizzes(),
  total: () => m.lms_part_total(),
  announcements: () => m.lms_area_announcements(),
  calendar: () => m.lms_part_calendar(),
  files: () => m.lms_area_files(),
  pages: () => m.lms_area_pages(),
  modules: () => m.lms_area_modules(),
  front_page: () => m.lms_part_front_page(),
}

/** "Submissions and feedback, course total". */
export function partsLabel(parts: readonly string[]): string {
  return parts.map((p) => PARTS[p]?.() ?? p).join(m.lms_sync_list_separator())
}

/**
 * Why the platform did not give it (M09 表 5c, rows 5-9), in a few words: the platform not
 * answering, a rate limit, an answer not understood, the area closed, or refused.
 */
export function reasonLabel(
  u: Pick<SyncUnreadable, 'code' | 'params' | 'parts'>,
  provider: string,
) {
  switch (u.code) {
    case 'lms.area_hidden':
      return m.lms_sync_reason_closed()
    case 'lms.rate_limited':
      return m.lms_sync_reason_rate_limited({ provider })
    case 'lms.unreachable':
      return u.params?.['reason'] === 'payload'
        ? m.lms_sync_reason_payload({ provider })
        : m.lms_sync_reason_unreachable({ provider })
    default:
      return u.parts?.includes('course')
        ? m.lms_sync_reason_course_refused()
        : m.lms_sync_reason_refused()
  }
}

/** A moment in the panel's rows: its time today, its day before ("14:20", "Nov 20"). */
export function shortWhen(at: string, now: number): string {
  return isSameDay(at, now) ? formatTime(at) : formatDate(at, { short: true })
}

/**
 * The courses whose last sync left something not updated (M09 表 5c, rows 5-7 and 9): an area
 * the teacher closed is the course's setting, not out of date (row 8).
 */
export function staleCourses(status: SyncStatus): string[] {
  return [...new Set(status.unreadable.filter((u) => u.kind !== 'area').map((u) => u.course_id))]
}
