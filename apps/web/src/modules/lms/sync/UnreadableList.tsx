import { useState } from 'react'
import type { SyncUnreadable } from '@semestra/api-client'
import { useRouter } from '@tanstack/react-router'
import { ClipboardList, EyeOff, Megaphone } from 'lucide-react'
import { PanelFold, PanelMoreList, PanelRow } from '@/components/StatusPanel'
import { useDialogTarget } from '@/lib/dialog-target'
import { formatTimeAgo } from '@/lib/format'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { scopePath } from '@/app/extensions'
import { filePath } from '@/modules/files/location'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { ANNOUNCEMENTS_PAGE } from '../announcements'
import { openAssignmentDetails } from '../assignment/target'
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
 * What the sync can't read since its area is closed on the platform (M09 table 3c, note): kept
 * as last read, and gone from the list by itself once the platform shows it again. A material
 * with a local copy can become the user's own file; one read online can be removed. An imported
 * assignment opens its details; the course's other assignments and its announcements are one row
 * each.
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
  const materials = unreadable.filter((u) => u.kind === 'material' && u.id)
  const saved = materials.filter((u) => u.local_copy).map((u) => u.id!)
  const online = materials.filter((u) => !u.local_copy).map((u) => u.id!)
  const reason = (u: SyncUnreadable) => {
    const why = m.lms_sync_unreadable_reason({ provider, area: AREA[u.area]?.() ?? u.area })
    return u.since && u.kind !== 'material' && u.kind !== 'assignment'
      ? m.lms_sync_unreadable_as_of({ reason: why, ago: formatTimeAgo(u.since, now) })
      : why
  }
  return (
    <>
      <PanelMoreList
        label={m.lms_sync_panel_unreadable()}
        count={unreadable.length}
        action={
          saved.length > 1 || online.length > 1 ? (
            <>
              {saved.length > 1 ? (
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => answers.settleAllMaterials(saved, 'mine')}
                >
                  {m.lms_sync_make_mine_all()}
                </Button>
              ) : null}
              {online.length > 1 ? (
                <Button
                  size="xs"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => setRemovingAll(true)}
                >
                  {m.lms_sync_unreadable_remove_all()}
                </Button>
              ) : null}
            </>
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
                    u.local_copy && u.item_id
                      ? filePath(programId, {
                          id: u.item_id,
                          course_id: u.course_id,
                          folder_id: null,
                        })
                      : undefined
                  }
                  onOpen={onClose}
                >
                  {u.local_copy ? (
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={busy}
                      onClick={() => answers.settleMaterial(key, 'mine')}
                    >
                      {m.lms_sync_make_mine()}
                    </Button>
                  ) : (
                    <Button
                      size="xs"
                      variant="destructive"
                      disabled={busy}
                      onClick={() => removing.show(u)}
                    >
                      {m.lms_sync_unreadable_remove()}
                    </Button>
                  )}
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
          return (
            <PanelRow
              key={key}
              icon={u.kind === 'announcements' ? Megaphone : ClipboardList}
              title={
                u.kind === 'announcements'
                  ? m.lms_sync_unreadable_announcements({ count: u.count })
                  : m.lms_sync_unreadable_assignments({ count: u.count })
              }
              {...shared}
              href={
                u.kind === 'announcements'
                  ? scopePath(
                      { kind: 'course', programId, courseId: u.course_id },
                      ANNOUNCEMENTS_PAGE,
                    )
                  : undefined
              }
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
          if (removing.target?.id) answers.settleMaterial(removing.target.id, 'remove')
          removing.close()
        }}
      />
      <ConfirmDialog
        open={removingAll}
        onOpenChange={setRemovingAll}
        title={m.lms_sync_unreadable_remove_all_title({ count: online.length })}
        description={m.lms_sync_unreadable_remove_all_description({ provider })}
        confirmLabel={m.lms_sync_unreadable_remove_all()}
        onConfirm={() => {
          answers.settleAllMaterials(online, 'remove')
          setRemovingAll(false)
        }}
      />
    </>
  )
}
