import type { SyncItem } from '@semestra/api-client'
import { PanelFold, PanelHeading, PanelRow } from '@/components/StatusPanel'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { ItemGroup } from '@/ui/item'
import { useAssignmentDetails } from '../assignment/target'
import type { SyncAnswers } from './answers'
import { pendingCount } from './labels'
import { type RowAction, pendingRows } from './pending-rows'
import type { CourseOf } from './rows'

/** How the panel draws a row's answers (`RowAction.tone`). */
export const PANEL_VARIANT = { quiet: 'ghost', main: 'outline', danger: 'destructive' } as const

export function PanelActions({ actions }: { actions: RowAction[] }) {
  return actions.map((action) => (
    <Button
      key={action.id}
      size="xs"
      variant={PANEL_VARIANT[action.tone]}
      disabled={action.disabled}
      onClick={action.run}
    >
      {action.label}
    </Button>
  ))
}

/**
 * What waits for the user (M09 §4.1, rows from `pendingRows`): new assignments to import or
 * ignore, assignments deleted on the platform to keep or delete (after a confirmation), and fields
 * both sides changed. A row opens the assignment's details (M09 §7.3).
 */
export function PendingSection({
  pending,
  provider,
  broken,
  answers,
  course,
  onImport,
  onDelete,
  onClose,
}: {
  pending: readonly SyncItem[]
  provider: string
  /** The connection is broken: nothing can be imported. */
  broken: boolean
  answers: SyncAnswers
  course: CourseOf
  onImport: (items: SyncItem[]) => void
  onDelete: (item: SyncItem) => void
  onClose: () => void
}) {
  const details = useAssignmentDetails()
  if (pending.length === 0) return null
  const rows = pendingRows(pending, { provider, answers, broken, onImport, onDelete })
  return (
    <section className="flex flex-col gap-1">
      <PanelHeading count={pendingCount(pending)}>{m.lms_sync_pending()}</PanelHeading>
      <ItemGroup className="gap-0 has-data-[size=xs]:gap-0">
        {rows.map((row) => (
          <PanelFold key={row.key} leaving={answers.leaving(row.key)}>
            <PanelRow
              icon={row.icon}
              title={row.title}
              {...course(row.item.course_id, row.item.course)}
              detail={row.detail}
              onOpen={() => {
                onClose()
                details.open(row.item.course_id, row.item.external_id)
              }}
            >
              <PanelActions actions={row.actions} />
            </PanelRow>
          </PanelFold>
        ))}
      </ItemGroup>
    </section>
  )
}
