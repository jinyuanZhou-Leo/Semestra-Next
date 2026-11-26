import type { SyncUnreadable } from '@semestra/api-client'
import { useRouter } from '@tanstack/react-router'
import { ClipboardList, CloudOff, EyeOff, FileText, School } from 'lucide-react'
import { useState } from 'react'
import { scopePath } from '@/app/extensions'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { PanelFold, PanelMoreList, PanelRow } from '@/components/StatusPanel'
import { useDialogTarget } from '@/lib/dialog-target'
import { courseFilesPath, filePath } from '@/modules/files/location'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { ANNOUNCEMENTS_PAGE } from '../announcements'
import { openAssignmentDetails } from '../assignment/target'
import { assignmentSource } from '../import/sources'
import type { SyncAnswers } from './answers'
import { partsLabel, reasonLabel, shortWhen } from './labels'
import type { CourseOf } from './rows'

const CLOSED = 'lms.area_hidden'

/**
 * "Not updated" (M09 表 5c, rows 5-9): what the platform did not give, kept as last read and
 * gone from the list by itself once it reads back. A row says what, the course, why and since
 * when. Parts of a course not read for one reason are one row (the whole course, when the course
 * itself is not read); an area the teacher closed is one row, with its items that can't be read
 * under it; any other item is a row of its own. A material read from the platform that is closed
 * or refused can be removed, one by one or all at once; one saved in Semestra has no action
 * (that copy may be the only one). An imported assignment opens its details, a closed area what
 * it keeps.
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
  const removing = useDialogTarget<SyncUnreadable>()
  const [removingAll, setRemovingAll] = useState(false)
  const { busy } = answers
  if (unreadable.length === 0) return null
  const removable = unreadable.filter((u) => u.removable && u.id).map((u) => u.id!)
  const closedAreas = new Set(
    unreadable.filter((u) => u.kind === 'area').map((u) => areaKey(u.course_id, u.area)),
  )
  // An item of a closed area listed goes under that area's row.
  const under = (u: SyncUnreadable) =>
    u.kind !== 'parts' &&
    u.kind !== 'area' &&
    u.code === CLOSED &&
    closedAreas.has(areaKey(u.course_id, u.area))
  const shared = { programId, provider, now, course, onClose }
  const item = (u: SyncUnreadable, nested: boolean) => (
    <ItemRow
      key={u.id ?? `${u.kind}:${u.course_id}:${u.external_id}`}
      {...shared}
      u={u}
      nested={nested}
      answers={answers}
      onRemove={removing.show}
    />
  )
  const rows = unreadable.flatMap((u) => {
    if (u.kind === 'parts')
      return [
        <PartsRow key={`parts:${u.course_id}:${(u.parts ?? []).join(',')}`} {...shared} u={u} />,
      ]
    if (u.kind === 'area') {
      const key = areaKey(u.course_id, u.area)
      const items = unreadable.filter((i) => under(i) && areaKey(i.course_id, i.area) === key)
      return [<AreaRow key={`area:${key}`} {...shared} u={u} />, ...items.map((i) => item(i, true))]
    }
    return under(u) ? [] : [item(u, false)]
  })

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
        {rows}
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

const areaKey = (courseId: string, area: string | null | undefined) => `${courseId}:${area}`

type RowProps = {
  u: SyncUnreadable
  programId: string
  provider: string
  now: number
  course: CourseOf
  onClose: () => void
}

function updated(u: SyncUnreadable, now: number) {
  return u.since
    ? m.lms_sync_updated_at({ time: shortWhen(u.since, now) })
    : m.lms_sync_never_updated()
}

function joined(...parts: (string | null)[]) {
  return parts.filter(Boolean).join(' · ')
}

/** 表 5c rows 5-7: parts of a course not read for one reason; the course itself, the course. */
function PartsRow({ u, provider, now, course }: RowProps) {
  const parts = u.parts ?? []
  const detail = joined(reasonLabel(u, provider), updated(u, now))
  if (parts.includes('course')) return <PanelRow icon={School} title={u.course} detail={detail} />
  return (
    <PanelRow
      icon={CloudOff}
      title={partsLabel(parts)}
      {...course(u.course_id, u.course)}
      detail={detail}
    />
  )
}

/** 表 5c row 8: an area the teacher closed; opens what it keeps. */
function AreaRow({ u, programId, now, course, onClose }: RowProps) {
  const scope = { kind: 'course' as const, programId, courseId: u.course_id }
  const shared = {
    icon: EyeOff,
    ...course(u.course_id, u.course),
    detail: joined(m.lms_sync_reason_closed(), updated(u, now)),
  }
  if (u.area === 'announcements')
    return (
      <PanelRow
        {...shared}
        title={
          u.count
            ? m.lms_sync_unreadable_announcements({ count: u.count })
            : partsLabel(['announcements'])
        }
        href={scopePath(scope, ANNOUNCEMENTS_PAGE)}
        onOpen={onClose}
      />
    )
  if (u.area === 'assignments')
    return (
      <PanelRow
        {...shared}
        title={
          u.count
            ? m.lms_sync_unreadable_assignments({ count: u.count })
            : partsLabel(['assignments'])
        }
        onOpen={() => {
          onClose()
          void assignmentSource.launch({ programId, courseId: u.course_id })
        }}
      />
    )
  if (u.area === 'quizzes') return <PanelRow {...shared} title={partsLabel(['quizzes'])} />
  return (
    <PanelRow
      {...shared}
      title={partsLabel([u.area ?? ''])}
      href={courseFilesPath(programId, u.course_id)}
      onOpen={onClose}
    />
  )
}

/**
 * 表 5c row 9: an item whose own read did not get it; under its area's row (no course, "can't be
 * read") when that area is closed.
 */
function ItemRow({
  u,
  nested,
  programId,
  provider,
  now,
  course,
  answers,
  onRemove,
  onClose,
}: RowProps & { nested: boolean; answers: SyncAnswers; onRemove: (u: SyncUnreadable) => void }) {
  const router = useRouter()
  const key = u.id ?? `${u.kind}:${u.course_id}:${u.external_id}`
  const since = u.since ? m.lms_sync_unreadable_since({ time: shortWhen(u.since, now) }) : null
  const shared = {
    ...(nested ? {} : course(u.course_id, u.course)),
    title: u.title ?? '',
    detail: joined(nested ? m.lms_sync_reason_item_closed() : reasonLabel(u, provider), since),
  }
  const row =
    u.kind === 'material' ? (
      <PanelRow
        icon={FileText}
        {...shared}
        href={
          u.item_id && !u.removable
            ? filePath(programId, { id: u.item_id, course_id: u.course_id, folder_id: null })
            : undefined
        }
        onOpen={onClose}
      >
        {u.removable ? (
          <Button
            size="xs"
            variant="destructive"
            disabled={answers.busy}
            onClick={() => onRemove(u)}
          >
            {m.lms_sync_unreadable_remove()}
          </Button>
        ) : null}
      </PanelRow>
    ) : (
      <PanelRow
        icon={ClipboardList}
        {...shared}
        onOpen={() => {
          onClose()
          if (u.external_id) openAssignmentDetails(router, u.course_id, u.external_id)
        }}
      />
    )
  return (
    <PanelFold leaving={answers.leaving(key)}>
      {nested ? <div className="pl-6">{row}</div> : row}
    </PanelFold>
  )
}
