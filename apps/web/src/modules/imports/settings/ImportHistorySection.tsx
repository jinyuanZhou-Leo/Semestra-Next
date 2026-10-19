import type { ImportSession } from '@semestra/api-client'
import { Link } from '@tanstack/react-router'
import { createColumnHelper, tableFeatures, useTable } from '@tanstack/react-table'
import { History } from 'lucide-react'
import { createContext, useContext } from 'react'
import type { SettingsSectionProps } from '@/app/extensions'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { formatDateTime } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table'
import { SOURCE_KIND_LABELS, STATUS_LABELS } from '../labels'
import { useImportHistory } from '../queries'

const features = tableFeatures({})
const column = createColumnHelper<typeof features, ImportSession>()

function resultText(session: ImportSession): string {
  const { summary } = session
  if (session.status === 'committed') {
    return m.imports_result_done({ created: summary.created ?? 0, updated: summary.updated ?? 0 })
  }
  const total = Object.values(summary.counts ?? {}).reduce((sum, n) => sum + n, 0)
  return session.status === 'ready' ? m.imports_history_items({ count: total }) : ''
}

/** The Program's import history (M08 §6.4): when, from what, how it went; opens the review. */
export function ImportHistorySection({ scope }: SettingsSectionProps) {
  const programId = scope?.programId ?? ''
  const history = useImportHistory(programId)
  return (
    <AsyncBoundary
      query={history}
      isEmpty={(page) => page.items.length === 0}
      empty={
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <History aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{m.imports_history_empty()}</EmptyTitle>
            <EmptyDescription>{m.imports_history_empty_hint()}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      }
    >
      {(page) => <HistoryTable programId={programId} sessions={page.items} />}
    </AsyncBoundary>
  )
}

// Columns live outside the component so cells keep their identity between renders (M03 note).
const ProgramIdContext = createContext('')

function OpenButton({ sessionId }: { sessionId: string }) {
  const programId = useContext(ProgramIdContext)
  return (
    <Button
      variant="ghost"
      size="sm"
      nativeButton={false}
      render={<Link to="/p/$programId/imports/$sessionId" params={{ programId, sessionId }} />}
    >
      {m.imports_history_open()}
    </Button>
  )
}

function SourceCell({ session }: { session: ImportSession }) {
  const names = session.source_refs.map((r) => r.filename).filter(Boolean)
  return (
    <span className="block max-w-56 truncate">
      {SOURCE_KIND_LABELS[session.source_kind]()}
      {names.length > 0 ? (
        <span className="text-muted-foreground"> · {names.join(', ')}</span>
      ) : null}
    </span>
  )
}

const columns = column.columns([
  column.accessor((s) => s.created_at, {
    id: 'created_at',
    header: () => m.imports_history_time(),
    cell: ({ getValue }) => formatDateTime(getValue()),
  }),
  column.accessor((s) => s.source_kind, {
    id: 'source',
    header: () => m.imports_history_source(),
    cell: ({ row }) => <SourceCell session={row.original} />,
  }),
  column.accessor((s) => s.status, {
    id: 'status',
    header: () => m.imports_history_status(),
    cell: ({ getValue }) => STATUS_LABELS[getValue()](),
  }),
  column.display({
    id: 'result',
    header: () => m.imports_history_result(),
    cell: ({ row }) => resultText(row.original),
  }),
  column.display({
    id: 'open',
    header: () => m.imports_history_open(),
    cell: ({ row }) =>
      row.original.status === 'discarded' ? null : <OpenButton sessionId={row.original.id} />,
  }),
])

const CELL_CLASS: Record<string, string> = {
  created_at: 'whitespace-nowrap tabular-nums',
  result: 'text-muted-foreground',
}

function HistoryTable({ programId, sessions }: { programId: string; sessions: ImportSession[] }) {
  const table = useTable({ features, columns, data: sessions, getRowId: (s) => s.id })
  return (
    <ProgramIdContext value={programId}>
      <div className="overflow-hidden rounded-2xl border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id}>
                {group.headers.map((h) => (
                  <TableHead key={h.id} scope="col">
                    {h.column.id === 'open' ? (
                      <span className="sr-only">
                        <table.FlexRender header={h} />
                      </span>
                    ) : (
                      <table.FlexRender header={h} />
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getAllCells().map((cell) => (
                  <TableCell key={cell.id} className={CELL_CLASS[cell.column.id]}>
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </ProgramIdContext>
  )
}
