import type { ImportSession } from '@semestra/api-client'
import { Link } from '@tanstack/react-router'
import { createColumnHelper, tableFeatures, useTable } from '@tanstack/react-table'
import { History } from 'lucide-react'
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

function HistoryTable({ programId, sessions }: { programId: string; sessions: ImportSession[] }) {
  const columns = column.columns([
    column.accessor((s) => s.created_at, {
      id: 'created_at',
      header: () => m.imports_history_time(),
      cell: ({ getValue }) => (
        <span className="whitespace-nowrap tabular-nums">{formatDateTime(getValue())}</span>
      ),
    }),
    column.accessor((s) => s.source_kind, {
      id: 'source',
      header: () => m.imports_history_source(),
      cell: ({ row }) => {
        const names = row.original.source_refs.map((r) => r.filename).filter(Boolean)
        return (
          <span className="block max-w-56 truncate">
            {SOURCE_KIND_LABELS[row.original.source_kind]()}
            {names.length > 0 ? (
              <span className="text-muted-foreground"> · {names.join(', ')}</span>
            ) : null}
          </span>
        )
      },
    }),
    column.accessor((s) => s.status, {
      id: 'status',
      header: () => m.imports_history_status(),
      cell: ({ getValue }) => STATUS_LABELS[getValue()](),
    }),
    column.display({
      id: 'result',
      header: () => m.imports_history_result(),
      cell: ({ row }) => <span className="text-muted-foreground">{resultText(row.original)}</span>,
    }),
    column.display({
      id: 'open',
      header: () => <span className="sr-only">{m.imports_history_open()}</span>,
      cell: ({ row }) =>
        row.original.status === 'discarded' ? null : (
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={
              <Link
                to="/p/$programId/imports/$sessionId"
                params={{ programId, sessionId: row.original.id }}
              />
            }
          >
            {m.imports_history_open()}
          </Button>
        ),
    }),
  ])
  const table = useTable({ features, columns, data: sessions, getRowId: (s) => s.id })
  return (
    <div className="overflow-hidden rounded-2xl border">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((h) => (
                <TableHead key={h.id} scope="col">
                  <table.FlexRender header={h} />
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id}>
              {row.getAllCells().map((cell) => (
                <TableCell key={cell.id}>
                  <table.FlexRender cell={cell} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
