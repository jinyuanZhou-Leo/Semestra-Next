import type { Meeting, MeetingException } from '@semestra/api-client'
import { type CellContext, createColumnHelper } from '@tanstack/react-table'
import { Plus, RotateCcw } from 'lucide-react'
import { createContext, use } from 'react'
import { ActionRow, SettingsTable, settingsTableFeatures } from '@/app/settings'
import { formatTime } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { dayLabel, sectionLabel } from '../labels'
import { ActionsHeader } from './ActionsHeader'

const features = settingsTableFeatures
export type ExceptionRow = { meeting: Meeting; exc: MeetingException }
const exceptionColumn = createColumnHelper<typeof features, ExceptionRow>()

type ExceptionsState = {
  busy: boolean
  onRestore: (meeting: Meeting, exc: MeetingException) => void
}
const ExceptionsContext = createContext<ExceptionsState | null>(null)

type ExceptionCell = CellContext<typeof features, ExceptionRow>

function ExceptionDateCell({ row }: ExceptionCell) {
  return dayLabel(row.original.exc.original_date)
}

function ExceptionSectionCell({ row }: ExceptionCell) {
  return sectionLabel(row.original.meeting)
}

function ExceptionChangeCell({ row }: ExceptionCell) {
  const { meeting, exc } = row.original
  // A changed start or end shows the class's new time range (the other end as it was).
  const retimed = exc.new_start_time || exc.new_end_time
  const when = [
    exc.new_date ? dayLabel(exc.new_date) : null,
    retimed
      ? `${formatTime(exc.new_start_time ?? meeting.start_time)} – ${formatTime(exc.new_end_time ?? meeting.end_time)}`
      : null,
    exc.new_location,
  ]
  return (
    <span className="whitespace-normal">
      {exc.kind === 'cancelled'
        ? m.schedule_status_cancelled()
        : m.schedule_moved_to({ when: when.filter(Boolean).join(' · ') })}
      {exc.note ? <span className="text-muted-foreground"> · {exc.note}</span> : null}
    </span>
  )
}

function ExceptionRestoreCell({ row }: ExceptionCell) {
  const state = use(ExceptionsContext)
  if (!state) throw new Error('ExceptionsTable cells must render inside ExceptionsTable')
  return (
    <div className="flex justify-end">
      <Button
        size="xs"
        variant="ghost"
        disabled={state.busy}
        onClick={() => state.onRestore(row.original.meeting, row.original.exc)}
      >
        <RotateCcw aria-hidden />
        {m.schedule_restore()}
      </Button>
    </div>
  )
}

const exceptionColumns = exceptionColumn.columns([
  exceptionColumn.accessor((r) => r.exc.original_date, {
    id: 'date',
    header: () => m.schedule_date(),
    cell: ExceptionDateCell,
  }),
  exceptionColumn.accessor((r) => r.meeting.section_code, {
    id: 'section',
    header: () => m.schedule_section_code(),
    cell: ExceptionSectionCell,
  }),
  exceptionColumn.display({
    id: 'change',
    header: () => m.schedule_exception_change(),
    cell: ExceptionChangeCell,
  }),
  exceptionColumn.display({ id: 'actions', header: ActionsHeader, cell: ExceptionRestoreCell }),
])

const EXCEPTION_COLUMN_CLASS: Record<string, string> = {
  change: 'w-full max-w-0',
}

/** Cancelled and moved classes, each with a button that puts the class back. */
export function ExceptionsTable({
  exceptions,
  busy,
  onRestore,
  onAdd,
}: {
  exceptions: ExceptionRow[]
  busy: boolean
  /** Opens the cancel-or-move dialog; without it the table has no add row. */
  onAdd?: () => void
  onRestore: (meeting: Meeting, exc: MeetingException) => void
}) {
  return (
    <ExceptionsContext value={{ busy, onRestore }}>
      <SettingsTable
        label={m.schedule_exceptions()}
        data={exceptions}
        columns={exceptionColumns}
        getRowId={(r) => r.exc.id}
        columnClassName={EXCEPTION_COLUMN_CLASS}
        footer={
          onAdd ? (
            <ActionRow icon={Plus} onClick={onAdd}>
              {m.schedule_exception_add()}
            </ActionRow>
          ) : undefined
        }
      />
    </ExceptionsContext>
  )
}
