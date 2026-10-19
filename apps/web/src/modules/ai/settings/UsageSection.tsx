import type { UsageDay, UsageRow, UsageSummary } from '@semestra/api-client'
import { aiUsageSummaryOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import {
  type SortingState,
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from '@tanstack/react-table'
import { ArrowDown, ArrowUp, BarChart3 } from 'lucide-react'
import { useState } from 'react'
import { useModules } from '@/app/registry'
import { SettingsBlock, SettingsNote } from '@/app/settings'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { AI_PURPOSES, type AiPurpose } from '@/hooks/use-ai-status'
import { formatCount, formatDate, formatUsd } from '@/lib/format'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group'
import { KIND_INFO, PURPOSE_TITLES, type ProviderKind } from '../labels'

export const USAGE_DAYS = 30

const PURPOSE_COLORS: Record<AiPurpose, string> = {
  chat: 'bg-chart-1',
  extraction: 'bg-chart-2',
  vision: 'bg-chart-3',
  embedding: 'bg-chart-4',
  title: 'bg-chart-5',
}

function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

/** The `days` local dates starting at `since` (YYYY-MM-DD), oldest first. */
function dateRange(since: string, days: number): string[] {
  const start = new Date(`${since.slice(0, 10)}T00:00:00Z`)
  return Array.from({ length: days }, (_, i) =>
    new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10),
  )
}

function cost(value: number | null, complete = true): string {
  if (value === null) return '—'
  return complete ? formatUsd(value) : m.ai_usage_cost_partial({ cost: formatUsd(value) })
}

function UsageChart({ summary }: { summary: UsageSummary }) {
  const days = dateRange(summary.since, USAGE_DAYS)
  const byDate = new Map<string, UsageDay[]>()
  for (const day of summary.by_day) byDate.set(day.date, [...(byDate.get(day.date) ?? []), day])
  const total = (d: UsageDay) => d.input_tokens + d.output_tokens
  const max = Math.max(
    1,
    ...days.map((date) => (byDate.get(date) ?? []).reduce((s, d) => s + total(d), 0)),
  )
  const used = AI_PURPOSES.filter((p) => summary.by_day.some((d) => d.purpose === p))
  const localDate = (date: string) => formatDate(`${date}T12:00:00`)

  return (
    <figure className="space-y-3">
      <ul className="flex h-36 items-end gap-0.5" aria-label={m.ai_usage_chart_title()}>
        {days.map((date) => {
          const entries = AI_PURPOSES.flatMap((p) =>
            (byDate.get(date) ?? []).filter((d) => d.purpose === p),
          )
          const sum = entries.reduce((s, d) => s + total(d), 0)
          const label = `${localDate(date)}: ${m.ai_usage_tokens_value({ tokens: formatCount(sum) })}`
          return (
            <li
              key={date}
              aria-label={label}
              title={label}
              className="flex h-full min-w-0 flex-1 flex-col-reverse rounded-sm bg-muted/50"
            >
              {entries.map((entry) => (
                <div
                  key={entry.purpose}
                  className={cn(
                    'w-full first:rounded-b-sm last:rounded-t-sm',
                    PURPOSE_COLORS[entry.purpose],
                  )}
                  style={{ height: `${(total(entry) / max) * 100}%` }}
                />
              ))}
            </li>
          )
        })}
      </ul>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{localDate(days[0] ?? summary.since)}</span>
        <span>{localDate(days.at(-1) ?? summary.since)}</span>
      </div>
      {used.length > 0 ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {used.map((purpose) => (
            <li key={purpose} className="flex items-center gap-1.5">
              <span aria-hidden className={cn('size-2.5 rounded-full', PURPOSE_COLORS[purpose])} />
              {PURPOSE_TITLES[purpose]()}
            </li>
          ))}
        </ul>
      ) : null}
    </figure>
  )
}

type Grouping = 'purpose' | 'module' | 'model'

const GROUPINGS: readonly Grouping[] = ['purpose', 'module', 'model']

const GROUP_TITLES: Record<Grouping, () => string> = {
  purpose: m.ai_usage_group_purpose,
  module: m.ai_usage_group_module,
  model: m.ai_usage_group_model,
}

function rowLabel(
  grouping: Grouping,
  key: string,
  moduleName: (id: string) => string | undefined,
): string {
  if (grouping === 'purpose') return PURPOSE_TITLES[key as AiPurpose]?.() ?? key
  if (grouping === 'module') return moduleName(key) ?? key
  if (grouping === 'model') {
    const [kind, ...rest] = key.split('/')
    const info = KIND_INFO[kind as ProviderKind]
    return info ? `${rest.join('/')} (${info.name()})` : key
  }
  return key
}

const features = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel() })
const column = createColumnHelper<typeof features, UsageRow>()

function UsageTable({ rows, grouping }: { rows: UsageRow[]; grouping: Grouping }) {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'tokens', desc: true }])
  const modules = useModules()
  const moduleName = (id: string) => modules.find((mod) => mod.id === id)?.name()
  const label = (key: string) => rowLabel(grouping, key, moduleName)
  const numeric = 'text-right tabular-nums'
  const columns = column.columns([
    column.accessor((r) => label(r.key), {
      id: 'key',
      header: () => GROUP_TITLES[grouping](),
      cell: ({ row }) => <span className="font-medium">{label(row.original.key)}</span>,
    }),
    column.accessor((r) => r.calls, {
      id: 'calls',
      header: () => m.ai_usage_calls(),
      cell: ({ row }) =>
        row.original.errors > 0
          ? m.ai_usage_calls_with_errors({
              calls: formatCount(row.original.calls),
              errors: formatCount(row.original.errors),
            })
          : formatCount(row.original.calls),
    }),
    column.accessor((r) => r.input_tokens + r.output_tokens, {
      id: 'tokens',
      header: () => m.ai_usage_tokens(),
      cell: ({ row }) => (
        <span
          title={m.ai_usage_tokens_split({
            input: formatCount(row.original.input_tokens),
            output: formatCount(row.original.output_tokens),
          })}
        >
          {formatCount(row.original.input_tokens + row.original.output_tokens)}
        </span>
      ),
    }),
    column.accessor((r) => r.cost_usd ?? -1, {
      id: 'cost',
      header: () => m.ai_usage_cost(),
      cell: ({ row }) => cost(row.original.cost_usd),
    }),
  ])
  const table = useTable({
    features,
    columns,
    data: rows,
    getRowId: (row) => row.key,
    state: { sorting },
    onSortingChange: (updater) =>
      setSorting(typeof updater === 'function' ? updater(sorting) : updater),
  })

  return (
    <Table>
      <TableHeader>
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id}>
            {group.headers.map((h) => {
              const sorted = h.column.getIsSorted()
              return (
                <TableHead
                  key={h.id}
                  className={h.column.id === 'key' ? undefined : numeric}
                  aria-sort={sorted ? (sorted === 'asc' ? 'ascending' : 'descending') : undefined}
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    className="-ml-2 h-8 px-2 font-normal text-muted-foreground"
                    onClick={h.column.getToggleSortingHandler()}
                  >
                    <table.FlexRender header={h} />
                    {sorted === 'asc' ? <ArrowUp aria-hidden className="size-3.5" /> : null}
                    {sorted === 'desc' ? <ArrowDown aria-hidden className="size-3.5" /> : null}
                  </Button>
                </TableHead>
              )
            })}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.map((row) => (
          <TableRow key={row.id}>
            {row.getAllCells().map((cell) => (
              <TableCell key={cell.id} className={cell.column.id === 'key' ? undefined : numeric}>
                <table.FlexRender cell={cell} />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

/** Account settings → AI → usage over the last 30 days (M06 §7). Costs are estimates. */
export function UsageSection() {
  const [grouping, setGrouping] = useState<Grouping>('purpose')
  const usage = useQuery(
    aiUsageSummaryOptions({ query: { days: USAGE_DAYS, tz: browserTimeZone() } }),
  )

  return (
    <AsyncBoundary query={usage}>
      {(summary) => (
        <div className="space-y-6">
          <dl className="grid grid-cols-2 gap-4 rounded-2xl border p-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">{m.ai_usage_calls()}</dt>
              <dd className="text-lg font-semibold tabular-nums">
                {formatCount(summary.totals.calls)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{m.ai_usage_tokens()}</dt>
              <dd className="text-lg font-semibold tabular-nums">
                {formatCount(summary.totals.input_tokens + summary.totals.output_tokens, {
                  compact: true,
                })}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{m.ai_usage_cost_estimate()}</dt>
              <dd className="text-lg font-semibold tabular-nums">
                {cost(summary.totals.cost_usd, summary.cost_complete)}
              </dd>
            </div>
          </dl>
          {summary.totals.calls === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <BarChart3 aria-hidden />
                </EmptyMedia>
                <EmptyTitle>{m.ai_usage_empty()}</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : (
            <>
              <SettingsBlock title={m.ai_usage_chart_title()}>
                <div className="rounded-2xl border p-4">
                  <UsageChart summary={summary} />
                </div>
              </SettingsBlock>
              <SettingsBlock
                title={m.ai_usage_details()}
                action={
                  <ToggleGroup
                    aria-label={m.ai_usage_details()}
                    value={[grouping]}
                    onValueChange={(next) => {
                      if (next[0]) setGrouping(next[0] as Grouping)
                    }}
                    variant="outline"
                    size="sm"
                  >
                    {GROUPINGS.map((value) => (
                      <ToggleGroupItem key={value} value={value}>
                        {GROUP_TITLES[value]()}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                }
              >
                <div className="overflow-hidden rounded-2xl border">
                  <UsageTable
                    key={grouping}
                    grouping={grouping}
                    rows={
                      grouping === 'purpose'
                        ? summary.by_purpose
                        : grouping === 'module'
                          ? summary.by_module
                          : summary.by_model
                    }
                  />
                </div>
              </SettingsBlock>
            </>
          )}
          <SettingsNote>{m.ai_usage_note()}</SettingsNote>
        </div>
      )}
    </AsyncBoundary>
  )
}
