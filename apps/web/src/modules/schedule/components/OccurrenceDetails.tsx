import type { Course, Occurrence } from '@semestra/api-client'
import {
  scheduleExceptionDeleteMutation,
  scheduleExceptionUpsertMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import {
  CalendarX2,
  CircleCheck,
  Circle,
  ExternalLink,
  MapPin,
  Pencil,
  RotateCcw,
  TriangleAlert,
  User,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useCalendarSources } from '@/app/registry'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/ui/dialog'
import { dayLabel, timeRange, weekLabel } from '../labels'
import { isMeeting, isOneOff, occurrenceColor } from '../occurrence'
import { invalidateSchedule } from '../queries'
import { wallDate } from '../time'

function Line({ icon: Icon, children }: { icon: typeof MapPin; children: ReactNode }) {
  return (
    <p className="flex items-center gap-2">
      <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0">{children}</span>
    </p>
  )
}

/**
 * Details of a calendar item (M04 §5.2) with its actions: open the source, and for classes
 * cancel or move this one, restore it, or edit the whole meeting.
 */
export function OccurrenceDetails({
  occurrence: o,
  timezone,
  programId,
  course,
  open,
  onOpenChangeComplete,
  onOpenChange,
  onMove,
  onEditMeeting,
  onEditEvent,
  onToggle,
}: {
  occurrence: Occurrence
  timezone: string
  programId: string
  course?: Course
  open: boolean
  /** Clear what the dialog is about here, once it has closed (`useDialogTarget`). */
  onOpenChangeComplete?: (open: boolean) => void
  onOpenChange: (open: boolean) => void
  onMove: (o: Occurrence) => void
  onEditMeeting: (o: Occurrence) => void
  onEditEvent: (o: Occurrence) => void
  /** The item can be checked off (its source has `complete`). */
  onToggle?: (completed: boolean) => void
}) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const source = useCalendarSources().find((s) => s.source === o.source)
  const done = async () => {
    await invalidateSchedule(queryClient)
    onOpenChange(false)
  }
  const cancel = useMutation({
    ...scheduleExceptionUpsertMutation(),
    onError: toastError,
    onSuccess: done,
  })
  const restore = useMutation({
    ...scheduleExceptionDeleteMutation(),
    onError: toastError,
    onSuccess: done,
  })
  const meetingId = o.meta?.meeting_id
  const originalDate = o.meta?.original_date
  const busy = cancel.isPending || restore.isPending
  const conflicts = o.meta?.conflicts_with?.length ?? 0

  const badges = [
    o.type_code ? (
      <Badge key="type" variant="outline">
        {o.type_code}
      </Badge>
    ) : null,
    o.meta?.section_code ? (
      <Badge key="section" variant="outline">
        {o.meta.section_code}
      </Badge>
    ) : null,
    o.status === 'cancelled' ? (
      <Badge key="status" variant="secondary">
        {m.schedule_status_cancelled()}
      </Badge>
    ) : null,
    o.status === 'moved' ? (
      <Badge key="status" variant="secondary">
        {m.schedule_status_moved()}
      </Badge>
    ) : null,
    o.status === 'done' ? (
      <Badge key="status" variant="secondary">
        {m.schedule_status_done()}
      </Badge>
    ) : null,
    o.status === 'overdue' ? (
      <Badge key="status" variant="destructive">
        {m.schedule_status_overdue()}
      </Badge>
    ) : null,
  ].filter((badge) => badge !== null)
  return (
    <Dialog open={open} onOpenChangeComplete={onOpenChangeComplete} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-8">
            <span
              aria-hidden
              className="size-3 shrink-0 rounded-full"
              style={{ backgroundColor: occurrenceColor(o) }}
            />
            <span className={o.status === 'cancelled' ? 'line-through' : undefined}>{o.title}</span>
          </DialogTitle>
          <DialogDescription>
            {dayLabel(wallDate(o.start_at, timezone))} · {timeRange(o, timezone)}
            {o.meta?.week_number != null ? ` · ${weekLabel(o.meta.week_number)}` : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {badges.length > 0 ? <div className="flex flex-wrap gap-1.5">{badges}</div> : null}
          {/* Titles start with the course code already: the line gives its name. */}
          {course ? <p className="font-medium">{course.title}</p> : null}
          {o.location ? <Line icon={MapPin}>{o.location}</Line> : null}
          {o.meta?.instructor ? <Line icon={User}>{o.meta.instructor}</Line> : null}
          {conflicts > 0 ? (
            <Line icon={TriangleAlert}>
              <span className="text-destructive">
                {m.schedule_conflict_with({ count: conflicts })}
              </span>
            </Line>
          ) : null}
          {o.status === 'moved' && o.meta?.original_start_at ? (
            <p className="text-muted-foreground">
              {m.schedule_moved_from({
                when: `${dayLabel(wallDate(o.meta.original_start_at, timezone))} ${timeRange(
                  { start_at: o.meta.original_start_at, end_at: null, all_day: false },
                  timezone,
                )}`,
              })}
            </p>
          ) : null}
          {o.meta?.note ? (
            <p className="whitespace-pre-line text-muted-foreground">{o.meta.note}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {onToggle ? (
            <Button variant="outline" size="sm" onClick={() => onToggle(o.status !== 'done')}>
              {o.status === 'done' ? <Circle aria-hidden /> : <CircleCheck aria-hidden />}
              {o.status === 'done' ? m.schedule_mark_not_done() : m.schedule_mark_done()}
            </Button>
          ) : null}
          {isMeeting(o) && meetingId && originalDate ? (
            o.status === 'cancelled' || o.status === 'moved' ? (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() =>
                  restore.mutate({ path: { meeting_id: meetingId, original_date: originalDate } })
                }
              >
                <RotateCcw aria-hidden />
                {m.schedule_restore()}
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    cancel.mutate({
                      path: { meeting_id: meetingId, original_date: originalDate },
                      body: { kind: 'cancelled' },
                    })
                  }
                >
                  <CalendarX2 aria-hidden />
                  {m.schedule_cancel_once()}
                </Button>
                <Button variant="outline" size="sm" disabled={busy} onClick={() => onMove(o)}>
                  {m.schedule_move_once()}
                </Button>
              </>
            )
          ) : null}
          {isMeeting(o) && meetingId ? (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => onEditMeeting(o)}>
              <Pencil aria-hidden />
              {m.schedule_edit_meeting()}
            </Button>
          ) : null}
          {isOneOff(o) ? (
            <Button variant="outline" size="sm" onClick={() => onEditEvent(o)}>
              <Pencil aria-hidden />
              {m.schedule_event_edit()}
            </Button>
          ) : null}
          {source?.onOpen ? (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={() => {
                onOpenChange(false)
                source.onOpen?.(o, (to) => router.history.push(to), { programId })
              }}
            >
              {source.openIcon ? <source.openIcon aria-hidden /> : <ExternalLink aria-hidden />}
              {source.OpenLabel ? (
                <source.OpenLabel programId={programId} occurrence={o} />
              ) : (
                m.schedule_open_source()
              )}
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
