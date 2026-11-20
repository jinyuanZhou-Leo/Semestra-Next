import type { SyncChange, SyncMaterialChange } from '@semestra/api-client'
import {
  ArrowRight,
  CalendarClock,
  FileCheck,
  FilePen,
  FilePlus,
  Files,
  FileX,
  type LucideIcon,
  PencilLine,
  Percent,
  SquareCheck,
} from 'lucide-react'
import { m } from '@/paraglide/messages'
import { formatValue } from './labels'

/** The pieces the sync panel's rows share (M09 §4.1). */

/** Rows' course chip: its code and color. */
export type CourseOf = (id: string, code: string) => { course: string; color?: string }

const FIELD_ICON: Record<string, LucideIcon> = {
  title: PencilLine,
  due_at: CalendarClock,
  weight: Percent,
  score: SquareCheck,
}

export const fieldIcon = (field: string): LucideIcon => FIELD_ICON[field] ?? PencilLine

export const MATERIAL_ICON: Record<SyncMaterialChange['change'], LucideIcon> = {
  added: FilePlus,
  duplicate: Files,
  updated: FilePen,
  gone: FileX,
  handed_over: FileCheck,
}

export const MATERIAL_TEXT: Record<SyncMaterialChange['change'], (provider: string) => string> = {
  added: () => m.lms_sync_material_added(),
  duplicate: () => m.lms_sync_material_duplicate(),
  updated: () => m.lms_sync_material_updated(),
  gone: (provider) => m.lms_sync_material_removed({ provider }),
  handed_over: (provider) => m.lms_sync_material_kept({ provider }),
}

/** What new feedback has: comments, a rubric score, or both. */
export function feedbackDetail(change: SyncChange): string {
  const news = change.new as { comments?: number; rubric?: boolean } | null
  return [
    news?.comments ? m.lms_sync_feedback_comments() : null,
    news?.rubric ? m.lms_sync_feedback_rubric() : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

/** A due date without its time when both sides share it ("Nov 25 → Nov 27"). */
function short(field: string, value: unknown, other: unknown): string {
  if (field !== 'due_at' || !value || !other) return formatValue(field, value)
  const a = value as { date: string; time: string | null }
  const b = other as { date: string; time: string | null }
  if (a.time === b.time && a.date !== b.date)
    return formatValue(field, { date: a.date, time: null })
  return formatValue(field, value)
}

/** "20% → 25%", the arrow an icon; the new value in the body color (struck when put back). */
export function Values({
  field,
  from,
  to,
  struck = false,
}: {
  field: string
  from: unknown
  to: unknown
  struck?: boolean
}) {
  return (
    <span className="whitespace-nowrap">
      {short(field, from, to)}
      <ArrowRight aria-label="→" className="mx-1 inline size-3 align-[-2px]" />
      <span className={struck ? 'line-through' : 'text-foreground'}>{short(field, to, from)}</span>
    </span>
  )
}
