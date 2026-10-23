import type { EventType, OneOffEvent } from '@semestra/api-client'
import { scheduleEventDeleteMutation } from '@semestra/api-client/react-query'
import { type CellContext, createColumnHelper } from '@tanstack/react-table'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { createContext, use, useState } from 'react'
import { ActionRow, RowMenu, SettingsTable, settingsTableFeatures } from '@/app/settings'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { toastError } from '@/lib/errors'
import { subjectColor } from '@/lib/subject-color'
import { m } from '@/paraglide/messages'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/ui/dropdown-menu'
import { dayLabel, timeRange, typeName } from '../labels'
import { invalidateSchedule } from '../queries'
import { wallDate } from '../time'
import { ActionsHeader } from './ActionsHeader'

const features = settingsTableFeatures
const eventColumn = createColumnHelper<typeof features, OneOffEvent>()

/**
 * Cells live at module level and read the page's state from context (see CoursesTable): a cell
 * defined inside the component would be a new component on every render and remount.
 */
type EventsState = {
  types: EventType[]
  timezone: string
  onEdit: (event: OneOffEvent) => void
  onDelete: (event: OneOffEvent) => void
}
const EventsContext = createContext<EventsState | null>(null)

function useEventsState(): EventsState {
  const state = use(EventsContext)
  if (!state) throw new Error('EventsTable cells must render inside EventsTable')
  return state
}

type EventCell = CellContext<typeof features, OneOffEvent>

/** Type color dot and title, with the type and location below; the title opens the editor. */
function EventTitleCell({ row }: EventCell) {
  const { types, onEdit } = useEventsState()
  const event = row.original
  const type = types.find((t) => t.code === event.type_code)
  const typeLabel = type ? typeName(type) : event.type_code
  const detail = [typeLabel, event.location].filter(Boolean).join(' · ')
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden
        className="size-2.5 shrink-0 rounded-full"
        style={{
          backgroundColor: type?.color ? subjectColor(type.color) : 'var(--muted-foreground)',
        }}
      />
      <span className="min-w-0 flex-1">
        <button
          type="button"
          className="block max-w-full cursor-pointer truncate rounded-sm text-left font-medium outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          onClick={() => onEdit(event)}
        >
          {event.title}
        </button>
        {detail ? (
          <span className="block truncate text-xs text-muted-foreground">{detail}</span>
        ) : null}
      </span>
    </div>
  )
}

function EventWhenCell({ row }: EventCell) {
  const { timezone } = useEventsState()
  return (
    <span className="block">
      <span className="block">{dayLabel(wallDate(row.original.start_at, timezone))}</span>
      <span className="block text-xs text-muted-foreground tabular-nums">
        {timeRange(row.original, timezone)}
      </span>
    </span>
  )
}

function EventActionsCell({ row }: EventCell) {
  const { onEdit, onDelete } = useEventsState()
  return (
    <RowMenu label={m.schedule_event_actions({ title: row.original.title })}>
      <DropdownMenuItem onClick={() => onEdit(row.original)}>
        <Pencil aria-hidden />
        {m.schedule_event_edit()}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" onClick={() => onDelete(row.original)}>
        <Trash2 aria-hidden />
        {m.schedule_event_delete()}
      </DropdownMenuItem>
    </RowMenu>
  )
}

const eventColumns = eventColumn.columns([
  eventColumn.accessor((e) => e.title, {
    id: 'title',
    header: () => m.schedule_event_title(),
    cell: EventTitleCell,
  }),
  eventColumn.accessor((e) => e.start_at, {
    id: 'when',
    header: () => m.schedule_date_time(),
    cell: EventWhenCell,
  }),
  eventColumn.display({ id: 'actions', header: ActionsHeader, cell: EventActionsCell }),
])

const EVENT_COLUMN_CLASS: Record<string, string> = {
  title: 'w-full max-w-0',
  actions: 'w-10',
}

/** The course's one-off events (exams, extra sessions) in the shared settings-table style. */
export function EventsTable({
  events,
  types,
  timezone,
  onEdit,
  onAdd,
}: {
  events: OneOffEvent[]
  types: EventType[]
  timezone: string
  onEdit: (event: OneOffEvent) => void
  onAdd: () => void
}) {
  const queryClient = useQueryClient()
  const [deleting, setDeleting] = useState<OneOffEvent | null>(null)
  const remove = useMutation({
    ...scheduleEventDeleteMutation(),
    onError: toastError,
    onSuccess: () => setDeleting(null),
    onSettled: () => invalidateSchedule(queryClient),
  })
  const sorted = events.toSorted((a, b) => a.start_at.localeCompare(b.start_at))
  return (
    <EventsContext value={{ types, timezone, onEdit, onDelete: setDeleting }}>
      <SettingsTable
        label={m.schedule_events()}
        data={sorted}
        columns={eventColumns}
        getRowId={(e) => e.id}
        columnClassName={EVENT_COLUMN_CLASS}
        footer={
          <ActionRow icon={Plus} onClick={onAdd}>
            {m.schedule_event_add()}
          </ActionRow>
        }
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={m.schedule_event_delete_title()}
        description={m.schedule_event_delete_description()}
        confirmLabel={m.schedule_event_delete()}
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate({ path: { event_id: deleting.id } })}
      />
    </EventsContext>
  )
}
