import type { SyncItem } from '@semestra/api-client'
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
