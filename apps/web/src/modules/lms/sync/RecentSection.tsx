import type { SyncChange, SyncMaterialChange } from '@semestra/api-client'
import { useNavigate } from '@tanstack/react-router'
import { MessageSquareText, Redo2, Undo2 } from 'lucide-react'
import { IconAction } from '@/components/IconAction'
import { PanelHeading, PanelRow } from '@/components/StatusPanel'
import { formatTimeAgo } from '@/lib/format'
import { filePath } from '@/modules/files/location'
import { m } from '@/paraglide/messages'
import { ItemGroup } from '@/ui/item'
import { feedbackPath } from '../feedback'
import type { SyncAnswers } from './answers'
import { fieldLabel } from './labels'
import {
  type CourseOf,
  MATERIAL_ICON,
  MATERIAL_TEXT,
  feedbackDetail,
  fieldIcon,
  Values,
} from './rows'

type Recent = (SyncChange & { type: 'field' }) | (SyncMaterialChange & { type: 'material' })

/**
 * What the sync changed lately (M09 §4.1), newest first: each assignment change can be put back
 * (and that undone), new feedback opens where it is shown, and course materials that came,
 * changed or went open from here.
 */
export function RecentSection({
  programId,
  changes,
  materials,
  provider,
  now,
  answers,
  course,
  onClose,
}: {
  programId: string
  changes: readonly SyncChange[]
  materials: readonly SyncMaterialChange[]
  provider: string
  now: number
  answers: SyncAnswers
  course: CourseOf
  onClose: () => void
}) {
  const navigate = useNavigate()
  const recent: Recent[] = [
    ...changes.map((change) => ({ ...change, type: 'field' as const })),
    ...materials.map((change) => ({ ...change, type: 'material' as const })),
  ].toSorted((a, b) => b.at.localeCompare(a.at))
  return (
    <section className="flex flex-col gap-1">
      <PanelHeading>{m.lms_sync_recent()}</PanelHeading>
      {recent.length > 0 ? (
        <ItemGroup className="gap-0 has-data-[size=xs]:gap-0">
          {recent.map((change) =>
            change.type === 'material' ? (
              <PanelRow
                key={change.id}
                icon={MATERIAL_ICON[change.change]}
                title={change.title}
                muted={change.change === 'gone'}
                {...course(change.course_id, change.course)}
                detail={
                  change.change === 'added' || change.change === 'updated'
                    ? (change.folder ?? MATERIAL_TEXT[change.change](provider))
                    : MATERIAL_TEXT[change.change](provider)
                }
                time={formatTimeAgo(change.at, now)}
                href={
                  change.item_id
                    ? filePath(programId, {
                        id: change.item_id,
                        course_id: change.course_id,
                        folder_id: change.folder_id ?? null,
                      })
                    : undefined
                }
                onOpen={onClose}
              />
            ) : change.kind === 'feedback' ? (
              <PanelRow
                key={change.id}
                icon={MessageSquareText}
                title={m.lms_sync_change({ title: change.title, field: fieldLabel(change.field) })}
                {...course(change.course_id, change.course)}
                detail={feedbackDetail(change)}
                time={formatTimeAgo(change.at, now)}
                onOpen={() => {
                  onClose()
                  void navigate({
                    href: feedbackPath(programId, change.course_id, change.target_id),
                  })
                }}
              />
            ) : (
              <PanelRow
                key={change.id}
                icon={fieldIcon(change.field)}
                title={m.lms_sync_change({ title: change.title, field: fieldLabel(change.field) })}
                muted={change.reverted}
                {...course(change.course_id, change.course)}
                detail={
                  <Values
                    field={change.field}
                    from={change.old}
                    to={change.new}
                    struck={change.reverted}
                  />
                }
                time={change.reverted ? m.lms_sync_undone() : formatTimeAgo(change.at, now)}
              >
                {change.toggleable ? (
                  <IconAction
                    label={change.reverted ? m.lms_sync_redo() : m.lms_sync_undo()}
                    disabled={answers.busy}
                    onClick={() => void answers.toggle(change)}
                    className="text-muted-foreground opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100"
                  >
                    {change.reverted ? <Redo2 aria-hidden /> : <Undo2 aria-hidden />}
                  </IconAction>
                ) : null}
              </PanelRow>
            ),
          )}
        </ItemGroup>
      ) : (
        <p className="px-2 text-xs text-muted-foreground">{m.lms_sync_recent_empty()}</p>
      )}
    </section>
  )
}
