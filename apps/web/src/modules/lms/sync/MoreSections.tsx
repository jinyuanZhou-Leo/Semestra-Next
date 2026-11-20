import type { SyncItem, SyncStatus } from '@semestra/api-client'
import { ClipboardPlus, CloudDownload, FileMinus } from 'lucide-react'
import { PanelFold, PanelIconAction, PanelMoreList, PanelRow } from '@/components/StatusPanel'
import { formatTimeAgo } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import type { SyncAnswers } from './answers'
import { fieldLabel, formatValue } from './labels'
import { type CourseOf, fieldIcon } from './rows'

/**
 * The folded lists at the panel's end (M09 §4.1): fields the user set apart from the platform
 * (each can take the platform's value again), materials the user removed and new items the user
 * ignored (each can be restored).
 */
export function MoreSections({
  status,
  provider,
  broken,
  now,
  answers,
  course,
  onImport,
}: {
  status: SyncStatus
  provider: string
  broken: boolean
  now: number
  answers: SyncAnswers
  course: CourseOf
  onImport: (items: SyncItem[]) => void
}) {
  const { busy, leaving } = answers
  const { different, removed_materials: removed, ignored } = status
  if (different.length === 0 && ignored.length === 0 && removed.length === 0) return null
  return (
    <section className="flex flex-col gap-0.5 border-t px-2 pt-2">
      {different.length > 0 ? (
        <PanelMoreList label={m.lms_sync_different({ provider })} count={different.length}>
          {different.map((d) => (
            <PanelFold key={`${d.id}:${d.field}`} leaving={leaving(`${d.id}:${d.field}`)}>
              <PanelRow
                icon={fieldIcon(d.field)}
                title={m.lms_sync_change({ title: d.title, field: fieldLabel(d.field) })}
                {...course(d.course_id, d.course)}
                detail={m.lms_sync_different_values({
                  mine: formatValue(d.field, d.mine),
                  provider,
                  platform: formatValue(d.field, d.platform),
                })}
              >
                <PanelIconAction
                  label={m.lms_sync_follow({ provider })}
                  disabled={busy}
                  onClick={() => answers.resolveField(d.id, d.field, 'platform')}
                >
                  <CloudDownload aria-hidden />
                </PanelIconAction>
              </PanelRow>
            </PanelFold>
          ))}
        </PanelMoreList>
      ) : null}
      {removed.length > 0 ? (
        <PanelMoreList
          label={m.lms_sync_panel_removed()}
          count={status.removed_count}
          action={
            status.removed_count > 1 ? (
              <Button
                size="xs"
                variant="ghost"
                disabled={busy}
                onClick={() => answers.restoreAll(removed.map((item) => item.id))}
              >
                {m.lms_sync_restore_all()}
              </Button>
            ) : null
          }
        >
          {removed.map((item) => (
            <PanelFold key={item.id} leaving={leaving(item.id)}>
              <PanelRow
                icon={FileMinus}
                title={item.title}
                {...course(item.course_id, item.course)}
                detail={m.lms_sync_removed_by_you({ ago: formatTimeAgo(item.at, now) })}
              >
                <Button
                  size="xs"
                  variant="outline"
                  disabled={busy}
                  onClick={() => answers.restore(item.id)}
                >
                  {m.lms_sync_restore()}
                </Button>
              </PanelRow>
            </PanelFold>
          ))}
        </PanelMoreList>
      ) : null}
      {ignored.length > 0 ? (
        <PanelMoreList label={m.lms_sync_panel_ignored()} count={ignored.length}>
          {ignored.map((item) => (
            <PanelFold key={item.id} leaving={leaving(item.id)}>
              <PanelRow
                icon={ClipboardPlus}
                title={item.title}
                {...course(item.course_id, item.course)}
                detail={m.lms_sync_kind_new()}
              >
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => answers.setDismissed([item], false)}
                >
                  {m.lms_sync_remind()}
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
          ))}
        </PanelMoreList>
      ) : null}
    </section>
  )
}
