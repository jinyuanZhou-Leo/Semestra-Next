import type { SyncItem, SyncStatus } from '@semestra/api-client'
import { CloudDownload, FileMinus } from 'lucide-react'
import { IconAction } from '@/components/IconAction'
import { PanelFold, PanelMoreList, PanelRow } from '@/components/StatusPanel'
import { formatTimeAgo } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import type { SyncAnswers } from './answers'
import { fieldLabel, formatValue } from './labels'
import { type CourseOf, fieldIcon } from './rows'
import { PanelActions } from './PendingSection'
import { ignoredRows } from './pending-rows'
import { UnreadableList } from './UnreadableList'

/**
 * The folded lists at the panel's end (M09 §4.1): what the platform did not give (表 5c), fields
 * set apart from the platform (each can take the platform's value again, unless it is out of
 * Semestra's range), materials the user removed and new items the user ignored (each can be
 * restored).
 */
export function MoreSections({
  programId,
  status,
  provider,
  broken,
  now,
  answers,
  course,
  onImport,
  onClose,
}: {
  programId: string
  status: SyncStatus
  provider: string
  broken: boolean
  now: number
  answers: SyncAnswers
  course: CourseOf
  onImport: (items: SyncItem[]) => void
  onClose: () => void
}) {
  const { busy, leaving } = answers
  const { different, removed_materials: removed, ignored, unreadable } = status
  if (
    different.length === 0 &&
    ignored.length === 0 &&
    removed.length === 0 &&
    unreadable.length === 0
  )
    return null
  return (
    <section className="flex flex-col gap-0.5 border-t px-2 pt-2">
      <UnreadableList
        programId={programId}
        unreadable={unreadable}
        provider={provider}
        now={now}
        answers={answers}
        course={course}
        onClose={onClose}
      />
      {different.length > 0 ? (
        <PanelMoreList label={m.lms_sync_different({ provider })} count={different.length}>
          {different.map((d) => (
            <PanelFold key={`${d.id}:${d.field}`} leaving={leaving(`${d.id}:${d.field}`)}>
              <PanelRow
                icon={fieldIcon(d.field)}
                title={m.lms_sync_change({ title: d.title, field: fieldLabel(d.field) })}
                {...course(d.course_id, d.course)}
                detail={(d.out_of_range
                  ? m.lms_sync_different_out_of_range
                  : m.lms_sync_different_values)({
                  mine: formatValue(d.field, d.mine),
                  provider,
                  platform: formatValue(d.field, d.platform),
                })}
              >
                {/* A value out of Semestra's range can't be taken: the user sets one in range. */}
                {d.out_of_range ? null : (
                  <IconAction
                    className="text-muted-foreground"
                    label={m.lms_sync_follow({ provider })}
                    disabled={busy}
                    onClick={() => answers.resolveField(d.id, d.field, 'platform')}
                  >
                    <CloudDownload aria-hidden />
                  </IconAction>
                )}
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
          {ignoredRows(ignored, { provider, answers, broken, onImport }).map((row) => (
            <PanelFold key={row.key} leaving={leaving(row.key)}>
              <PanelRow
                icon={row.icon}
                title={row.title}
                {...course(row.item.course_id, row.item.course)}
                detail={row.detail}
              >
                <PanelActions actions={row.actions} />
              </PanelRow>
            </PanelFold>
          ))}
        </PanelMoreList>
      ) : null}
    </section>
  )
}
