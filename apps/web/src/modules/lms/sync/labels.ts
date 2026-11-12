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

/** New items grouped by course, in the order they come (soonest due first). */
export function byCourse(items: readonly SyncItem[]): { courseId: string; items: SyncItem[] }[] {
  const groups = new Map<string, SyncItem[]>()
  for (const item of items)
    groups.set(item.course_id, [...(groups.get(item.course_id) ?? []), item])
  return [...groups].map(([courseId, grouped]) => ({ courseId, items: grouped }))
}
