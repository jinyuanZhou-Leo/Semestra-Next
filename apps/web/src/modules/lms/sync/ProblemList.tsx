import type { SyncProblem } from '@semestra/api-client'
import { Check, CircleAlert, Copy } from 'lucide-react'
import { useState } from 'react'
import { IconAction } from '@/components/IconAction'
import { PanelMoreList, PanelRow } from '@/components/StatusPanel'
import { copyText } from '@/lib/clipboard'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { partsLabel } from './labels'
import type { CourseOf } from './rows'

// What a stage writes (its row when the whole stage did not sync), and what its items are.
const STAGE: Record<string, () => string> = {
  course: () => m.lms_part_course(),
  assignments: () => m.lms_area_assignments(),
  announcements: () => m.lms_area_announcements(),
  calendar: () => m.lms_part_calendar(),
  files: () => m.lms_sync_stage_files(),
}
const ITEMS: Record<string, () => string> = {
  assignments: () => m.lms_area_assignments(),
  announcements: () => m.lms_area_announcements(),
  calendar: () => m.lms_sync_kind_events(),
  files: () => m.lms_sync_stage_files(),
}

/**
 * "Sync errors" (M09 表 5c, rows 2-4): Semestra's own problems in the courses' last sync. They
 * come back every round and the user can do nothing but report them, so each row names what did
 * not sync and gives the error ID to copy; no retry. Open when the panel opens.
 */
export function ProblemList({ problems, course }: { problems: SyncProblem[]; course: CourseOf }) {
  if (problems.length === 0) return null
  const rows = problems.flatMap((p) => {
    const key = `${p.course_id}:${p.stage}`
    const copy = <CopyId id={p.request_id} />
    const shared = { ...course(p.course_id, p.course), icon: CircleAlert, tone: 'error' as const }
    if (p.ended)
      return [
        <PanelRow
          key={key}
          icon={CircleAlert}
          tone="error"
          title={p.course}
          detail={m.lms_sync_problem_course()}
        >
          {copy}
        </PanelRow>,
      ]
    const out = []
    if (p.items.length > 0)
      out.push(
        <PanelRow
          key={`${key}:items`}
          {...shared}
          title={p.items.map((i) => i.title ?? i.external_id).join(m.lms_sync_list_separator())}
          detail={m.lms_sync_problem_items({
            count: p.items.length,
            kind: (ITEMS[p.stage] ?? STAGE[p.stage])?.() ?? p.stage,
          })}
        >
          {copy}
        </PanelRow>,
      )
    if (p.reads.length > 0)
      out.push(
        <PanelRow
          key={`${key}:reads`}
          {...shared}
          title={partsLabel(p.reads)}
          detail={m.lms_sync_problem_not_synced()}
        >
          {copy}
        </PanelRow>,
      )
    if (out.length === 0)
      out.push(
        <PanelRow
          key={key}
          {...shared}
          title={STAGE[p.stage]?.() ?? p.stage}
          detail={m.lms_sync_problem_not_synced()}
        >
          {copy}
        </PanelRow>,
      )
    return out
  })
  return (
    <PanelMoreList label={m.lms_sync_panel_failed()} count={rows.length} tone="error" defaultOpen>
      {rows}
    </PanelMoreList>
  )
}

/** Copies the error ID the logs carry, to report the problem with. */
function CopyId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <IconAction
      className="text-muted-foreground"
      label={m.lms_sync_copy_error_id()}
      onClick={() => copyText(id).then(() => setCopied(true), toastError)}
    >
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
    </IconAction>
  )
}
