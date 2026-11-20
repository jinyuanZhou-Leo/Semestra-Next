import type { SyncItem } from '@semestra/api-client'
import { ClipboardPlus, Trash2 } from 'lucide-react'
import { PanelFold, PanelHeading, PanelRow } from '@/components/StatusPanel'
import { formatDate } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { ItemGroup } from '@/ui/item'
import type { SyncAnswers } from './answers'
import { fieldLabel, pendingCount } from './labels'
import { type CourseOf, fieldIcon, Values } from './rows'

/**
 * What waits for the user (M09 §4.1): new assignments to import or ignore, assignments deleted on
 * the platform to keep or delete (after a confirmation), and fields both sides changed.
 */
export function PendingSection({
  pending,
  provider,
  broken,
  answers,
  course,
  onImport,
  onDelete,
}: {
  pending: readonly SyncItem[]
  provider: string
  /** The connection is broken: nothing can be imported. */
  broken: boolean
  answers: SyncAnswers
  course: CourseOf
  onImport: (items: SyncItem[]) => void
  onDelete: (item: SyncItem) => void
}) {
  const { busy, leaving } = answers
  if (pending.length === 0) return null
  return (
    <section className="flex flex-col gap-1">
      <PanelHeading count={pendingCount(pending)}>{m.lms_sync_pending()}</PanelHeading>
      <ItemGroup className="gap-0 has-data-[size=xs]:gap-0">
        {pending.map((item) =>
          item.kind === 'new' ? (
            <PanelFold key={item.id} leaving={leaving(item.id)}>
              <PanelRow
                icon={ClipboardPlus}
                title={item.title}
                {...course(item.course_id, item.course)}
                detail={
                  item.due_at
                    ? m.lms_sync_panel_new_due({ due: formatDate(item.due_at, { short: true }) })
                    : m.lms_sync_kind_new()
                }
              >
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => answers.setDismissed([item], true)}
                >
                  {m.lms_sync_ignore()}
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={broken}
                  onClick={() => onImport([item])}
                >
                  {m.lms_sync_import()}
                </Button>
              </PanelRow>
            </PanelFold>
          ) : item.kind === 'removed' ? (
            <PanelFold key={item.id} leaving={leaving(item.id)}>
              <PanelRow
                icon={Trash2}
                title={item.title}
                {...course(item.course_id, item.course)}
                detail={m.lms_sync_removed({ provider })}
              >
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => answers.settle(item, 'keep')}
                >
                  {m.lms_sync_keep()}
                </Button>
                <Button
                  size="xs"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => onDelete(item)}
                >
                  {m.lms_sync_delete()}
                </Button>
              </PanelRow>
            </PanelFold>
          ) : (
            (item.conflicts ?? []).map((conflict) => (
              <PanelFold
                key={`${item.id}:${conflict.field}`}
                leaving={leaving(`${item.id}:${conflict.field}`)}
              >
                <PanelRow
                  icon={fieldIcon(conflict.field)}
                  title={m.lms_sync_change({
                    title: item.title,
                    field: fieldLabel(conflict.field),
                  })}
                  {...course(item.course_id, item.course)}
                  detail={
                    <>
                      <Values field={conflict.field} from={conflict.mine} to={conflict.platform} />
                      {conflict.edited ? ` · ${m.lms_sync_yours_changed()}` : null}
                    </>
                  }
                >
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => answers.resolveField(item.id, conflict.field, 'mine')}
                  >
                    {m.lms_sync_keep()}
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={busy}
                    onClick={() => answers.resolveField(item.id, conflict.field, 'platform')}
                  >
                    {m.lms_sync_update()}
                  </Button>
                </PanelRow>
              </PanelFold>
            ))
          ),
        )}
      </ItemGroup>
    </section>
  )
}
