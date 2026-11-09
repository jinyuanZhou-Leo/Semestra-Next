import type { Course, Occurrence } from '@semestra/api-client'
import {
  scheduleExceptionDeleteMutation,
  scheduleExceptionUpsertMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight,
  CalendarClock,
  CalendarX2,
  Clock,
  Ellipsis,
  History,
  MapPin,
  NotebookText,
  Pencil,
  RotateCcw,
  TriangleAlert,
  User,
  Users,
  X,
} from 'lucide-react'
import { type ComponentProps, type ReactNode, useRef } from 'react'
import { useCalendarSources } from '@/app/registry'
import { toastError } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Checkbox } from '@/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from '@/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { dayLabel, timeRange, weekLabel } from '../labels'
import { useOpenOccurrence } from '../open'
import { isMeeting, isOneOff, occurrenceColor } from '../occurrence'
import { invalidateSchedule } from '../queries'
import { wallDate } from '../time'

/**
 * Where the clicked item sits, relative to the positioned box `OccurrenceDetails` renders in, and
 * the side the details open on: beside a block, below a row that spans the calendar (list view).
 */
export type DetailsAnchor = {
  left: number
  top: number
  width: number
  height: number
  side: 'right' | 'bottom'
  /** The clicked item itself: focus goes back to it when the details close. */
  item: HTMLElement
}

function Line({
  icon: Icon,
  className,
  children,
}: {
  icon: typeof MapPin
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn('flex gap-3', className)}>
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">{children}</div>
    </div>
  )
}

function IconAction({
  label,
  children,
  ...props
}: { label: string; children: ReactNode } & Omit<ComponentProps<typeof Button>, 'children'>) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label={label} {...props} />}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * Details of a calendar item (M04 §5.2), next to the item: what and when, then where it leads.
 * Classes are edited, moved, cancelled or restored from the header; to-dos are checked off there.
 */
export function OccurrenceDetails({
  occurrence: o,
  anchor,
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
  anchor: DetailsAnchor
  timezone: string
  programId: string
  course?: Course
  open: boolean
  /** Clear what the details are about here, once they have closed (`useDialogTarget`). */
  onOpenChangeComplete?: (open: boolean) => void
  onOpenChange: (open: boolean) => void
  onMove: (o: Occurrence) => void
  onEditMeeting: (o: Occurrence) => void
  onEditEvent: (o: Occurrence) => void
  /** The item can be checked off (its source has `complete`). */
  onToggle?: (completed: boolean) => void
}) {
  const queryClient = useQueryClient()
  const popup = useRef<HTMLDivElement>(null)
  const source = useCalendarSources().find((s) => s.source === o.source)
  const openItem = useOpenOccurrence(programId)(o)
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
  const meetingId = isMeeting(o) ? o.meta?.meeting_id : undefined
  const originalDate = o.meta?.original_date
  const busy = cancel.isPending || restore.isPending
  const conflicts = o.meta?.conflicts_with?.length ?? 0
  const finished = o.status === 'cancelled' || o.status === 'done'
  const section = o.meta?.section_code ?? o.type_code
  const editLabel = meetingId
    ? m.schedule_edit_meeting()
    : isOneOff(o)
      ? m.schedule_event_edit()
      : null
  const OpenIcon = source?.open?.icon ?? ArrowRight

  return (
    <Popover open={open} onOpenChange={onOpenChange} onOpenChangeComplete={onOpenChangeComplete}>
      {/* The popover sits against the clicked item: a box over it is its anchor. */}
      <PopoverTrigger
        nativeButton={false}
        render={
          <span
            aria-hidden
            tabIndex={-1}
            className="pointer-events-none absolute"
            style={{
              left: anchor.left,
              top: anchor.top,
              width: anchor.width,
              height: anchor.height,
            }}
          />
        }
      />
      <PopoverContent
        ref={popup}
        // Focus the details themselves, not the first icon button (its tooltip would show).
        initialFocus={popup}
        // Back to the item when it is still drawn (a refetch can redraw the calendar meanwhile),
        // never to the hidden anchor.
        finalFocus={() => (anchor.item.isConnected ? anchor.item : false)}
        side={anchor.side}
        align="start"
        sideOffset={anchor.side === 'bottom' ? 4 : 8}
        className="w-84 gap-3"
      >
        <div className="flex items-start gap-3">
          {onToggle ? (
            <Checkbox
              aria-label={m.schedule_check_item({ title: o.title })}
              checked={o.status === 'done'}
              onCheckedChange={onToggle}
              className="task-check mt-0.5 size-4.5 rounded-full"
            />
          ) : (
            <span
              aria-hidden
              className="mt-0.5 h-5 w-1 shrink-0 rounded-full"
              style={{ backgroundColor: occurrenceColor(o) }}
            />
          )}
          <div className="min-w-0 flex-1">
            <PopoverTitle
              className={cn('leading-snug', finished && 'text-muted-foreground line-through')}
            >
              {o.title}
            </PopoverTitle>
            {/* Titles start with the course code already: the line gives its name. */}
            {course ? <PopoverDescription>{course.title}</PopoverDescription> : null}
          </div>
          <div className="-mt-1 -mr-1 flex shrink-0 items-center">
            {editLabel ? (
              <IconAction
                label={editLabel}
                disabled={busy}
                onClick={() => (meetingId ? onEditMeeting(o) : onEditEvent(o))}
              >
                <Pencil />
              </IconAction>
            ) : null}
            {meetingId && originalDate ? (
              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            disabled={busy}
                            aria-label={m.common_more_actions()}
                          />
                        }
                      />
                    }
                  >
                    <Ellipsis />
                  </TooltipTrigger>
                  <TooltipContent>{m.common_more_actions()}</TooltipContent>
                </Tooltip>
                <DropdownMenuContent align="end" className="w-40">
                  {o.status === 'cancelled' || o.status === 'moved' ? (
                    <DropdownMenuItem
                      onClick={() =>
                        restore.mutate({
                          path: { meeting_id: meetingId, original_date: originalDate },
                        })
                      }
                    >
                      <RotateCcw />
                      {m.schedule_restore()}
                    </DropdownMenuItem>
                  ) : (
                    <>
                      <DropdownMenuItem onClick={() => onMove(o)}>
                        <CalendarClock />
                        {m.schedule_move_once()}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() =>
                          cancel.mutate({
                            path: { meeting_id: meetingId, original_date: originalDate },
                            body: { kind: 'cancelled' },
                          })
                        }
                      >
                        <CalendarX2 />
                        {m.schedule_cancel_once()}
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            <IconAction label={m.common_close()} onClick={() => onOpenChange(false)}>
              <X />
            </IconAction>
          </div>
        </div>

        <div className="space-y-2 pl-4">
          <Line icon={Clock}>
            {dayLabel(wallDate(o.start_at, timezone))} · {timeRange(o, timezone)}
            {o.meta?.week_number != null ? (
              <span className="text-muted-foreground"> · {weekLabel(o.meta.week_number)}</span>
            ) : null}
            {o.status === 'overdue' ? (
              <span className="text-destructive"> · {m.schedule_status_overdue()}</span>
            ) : null}
          </Line>
          {o.status === 'cancelled' ? (
            <Line icon={CalendarX2}>{m.schedule_status_cancelled()}</Line>
          ) : null}
          {o.status === 'moved' && o.meta?.original_start_at ? (
            <Line icon={History}>
              <span className="text-muted-foreground">
                {m.schedule_moved_from({
                  when: `${dayLabel(wallDate(o.meta.original_start_at, timezone))} ${timeRange(
                    { start_at: o.meta.original_start_at, end_at: null, all_day: false },
                    timezone,
                  )}`,
                })}
              </span>
            </Line>
          ) : null}
          {o.location ? <Line icon={MapPin}>{o.location}</Line> : null}
          {o.meta?.instructor ? <Line icon={User}>{o.meta.instructor}</Line> : null}
          {section ? <Line icon={Users}>{section}</Line> : null}
          {conflicts > 0 ? (
            <Line icon={TriangleAlert} className="text-destructive">
              {m.schedule_conflict_with({ count: conflicts })}
            </Line>
          ) : null}
          {o.meta?.note ? (
            <Line icon={NotebookText}>
              <span className="whitespace-pre-line text-muted-foreground">{o.meta.note}</span>
            </Line>
          ) : null}
        </div>

        {openItem && source?.open ? (
          <Button
            variant="secondary"
            className="mt-1 w-full justify-between"
            onClick={() => {
              onOpenChange(false)
              openItem()
            }}
          >
            <source.open.Label programId={programId} occurrence={o} />
            <OpenIcon aria-hidden />
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
