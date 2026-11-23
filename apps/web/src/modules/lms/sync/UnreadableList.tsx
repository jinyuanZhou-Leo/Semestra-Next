import type { SyncUnreadable } from '@semestra/api-client'
import { useRouter } from '@tanstack/react-router'
import { ClipboardList, EyeOff, Megaphone } from 'lucide-react'
import { useState } from 'react'
import { scopePath } from '@/app/extensions'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { PanelFold, PanelMoreList, PanelRow } from '@/components/StatusPanel'
import { useDialogTarget } from '@/lib/dialog-target'
import { formatTimeAgo } from '@/lib/format'
import { filePath } from '@/modules/files/location'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { ANNOUNCEMENTS_PAGE } from '../announcements'
import { openAssignmentDetails } from '../assignment/target'
import { assignmentSource } from '../import/sources'
import type { SyncAnswers } from './answers'
import type { CourseOf } from './rows'

const AREA: Record<string, () => string> = {
  files: m.lms_area_files,
  pages: m.lms_area_pages,
  modules: m.lms_area_modules,
  assignments: m.lms_area_assignments,
  announcements: m.lms_area_announcements,
}

/**
 * "Not syncing for now" (M09 table 3c, note): what the sync can't read since its area is closed
 * on the platform, kept as last read and gone from the list by itself once the platform shows it
 * again. A material read from the platform can be removed, one by one or all at once; one saved
 * in Semestra has no action (that copy may be the only one, and it follows the platform again
 * once the area opens). An imported assignment opens its details; a course's assignments not
 * imported are one row that opens their import, its announcements one row that opens its
 * announcements page.
 */
export function UnreadableList({
  programId,
  unreadable,
  provider,
  now,
  answers,
  course,
  onClose,
}: {
  programId: string
  unreadable: SyncUnreadable[]
  provider: string
  now: number
  answers: SyncAnswers
  course: CourseOf
  onClose: () => void
}) {
  const router = useRouter()
  const removing = useDialogTarget<SyncUnreadable>()
  const [removingAll, setRemovingAll] = useState(false)
  const { busy, leaving } = answers
  if (unreadable.length === 0) return null
  const removable = unreadable.filter((u) => u.removable && u.id).map((u) => u.id!)
  const reason = (u: SyncUnreadable) => {
    const why = m.lms_sync_unreadable_reason({ provider, area: AREA[u.area]?.() ?? u.area })
    return u.since
      ? m.lms_sync_unreadable_as_of({ reason: why, ago: formatTimeAgo(u.since, now) })
      : why
  }
  return (
    <>
      <PanelMoreList
        label={m.lms_sync_panel_unreadable()}
        count={unreadable.length}
        action={
          removable.length > 1 ? (
            <Button
              size="xs"
              variant="destructive"
              disabled={busy}
              onClick={() => setRemovingAll(true)}
            >
              {m.lms_sync_unreadable_remove_all()}
            </Button>
          ) : null
        }
      >
        {unreadable.map((u) => {
          const key = u.id ?? `${u.kind}:${u.course_id}`
          const shared = { ...course(u.course_id, u.course), detail: reason(u) }
          if (u.kind === 'material') {
            return (
              <PanelFold key={key} leaving={leaving(key)}>
                <PanelRow
                  icon={EyeOff}
                  title={u.title ?? ''}
                  {...shared}
                  href={
                    u.item_id && !u.removable
                      ? filePath(programId, {
                          id: u.item_id,
                          course_id: u.course_id,
                          folder_id: null,
                        })
                      : undefined
                  }
                  onOpen={onClose}
                >
                  {u.removable ? (
                    <Button
                      size="xs"
                      variant="destructive"
                      disabled={busy}
                      onClick={() => removing.show(u)}
                    >
                      {m.lms_sync_unreadable_remove()}
                    </Button>
                  ) : null}
                </PanelRow>
              </PanelFold>
            )
          }
          if (u.kind === 'assignment') {
            return (
              <PanelFold key={key} leaving={leaving(key)}>
                <PanelRow
                  icon={ClipboardList}
                  title={u.title ?? ''}
                  {...shared}
                  onOpen={() => {
                    onClose()
                    if (u.external_id) openAssignmentDetails(router, u.course_id, u.external_id)
                  }}
                />
              </PanelFold>
            )
          }
          if (u.kind === 'assignments') {
            return (
              <PanelRow
                key={key}
                icon={ClipboardList}
                title={m.lms_sync_unreadable_assignments({ count: u.count })}
                {...shared}
                onOpen={() => {
                  onClose()
                  void assignmentSource.launch({ programId, courseId: u.course_id })
                }}
              />
            )
          }
          return (
            <PanelRow
              key={key}
              icon={Megaphone}
              title={m.lms_sync_unreadable_announcements({ count: u.count })}
              {...shared}
              href={scopePath(
                { kind: 'course', programId, courseId: u.course_id },
                ANNOUNCEMENTS_PAGE,
              )}
              onOpen={onClose}
            />
          )
        })}
      </PanelMoreList>
      <ConfirmDialog
        {...removing.props}
        title={m.lms_sync_unreadable_remove_title({ title: removing.target?.title ?? '' })}
        description={m.lms_sync_unreadable_remove_description({ provider })}
        confirmLabel={m.lms_sync_unreadable_remove()}
        onConfirm={() => {
          if (removing.target?.id) answers.removeMaterial(removing.target.id)
          removing.close()
        }}
      />
      <ConfirmDialog
        open={removingAll}
        onOpenChange={setRemovingAll}
        title={m.lms_sync_unreadable_remove_all_title({ count: removable.length })}
        description={m.lms_sync_unreadable_remove_all_description({ provider })}
        confirmLabel={m.lms_sync_unreadable_remove_all()}
        onConfirm={() => {
          answers.removeAllMaterials(removable)
          setRemovingAll(false)
        }}
      />
    </>
  )
}
