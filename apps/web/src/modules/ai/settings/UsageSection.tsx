import type { UsageRow, UsageSummary } from '@semestra/api-client'
import { aiUsageSummaryOptions } from '@semestra/api-client/react-query'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  type CellContext,
  type SortingState,
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from '@tanstack/react-table'
import { ArrowDown, ArrowUp, BarChart3, X } from 'lucide-react'
import { type CSSProperties, type ReactNode, createContext, use, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from 'recharts'
import { useModules } from '@/app/registry'
import { SettingsBlock, SettingsNote } from '@/app/settings'
import { useUiPref } from '@/app/ui-pref'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { AI_PURPOSES, type AiPurpose } from '@/hooks/use-ai-status'
import { formatCount, formatDate, formatPercent, formatUsd } from '@/lib/format'
import { SEGMENT, SEGMENTED } from '@/lib/segmented'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/ui/chart'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group'
import { KIND_INFO, PURPOSE_TITLES, type ProviderKind } from '../labels'

type UsageRange = '7' | '30' | 'all'

const RANGES: readonly UsageRange[] = ['7', '30', 'all']

const RANGE_TITLES: Record<UsageRange, () => string> = {
  '7': () => m.ai_usage_range_days({ days: 7 }),
  '30': () => m.ai_usage_range_days({ days: 30 }),
  all: m.ai_usage_range_all,
}

/** Longer ranges are drawn a week per bar. */
const DAILY_BARS_MAX = 90

function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

/** `YYYY-MM-DD` plus `n` days. */
function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date.slice(0, 10)}T00:00:00Z`) + n * 86_400_000)
    .toISOString()
    .slice(0, 10)
}

function cost(value: number | null, complete = true): string {
  if (value === null) return '—'
  return complete ? formatUsd(value) : m.ai_usage_cost_partial({ cost: formatUsd(value) })
}

/** One bar: a day, or a week for long ranges. Tokens per purpose are left out when there are none. */
type Bucket = Partial<Record<AiPurpose, number>> & {
  start: string
  end: string
  tokens: number
  calls: number
  cost: number | null
  costComplete: boolean
}

/** Days covered by the summary. */
function spanDays(summary: UsageSummary): number {
  return (
    Math.round((Date.parse(summary.until) - Date.parse(summary.since.slice(0, 10))) / 86_400_000) +
    1
  )
}

export function buckets(summary: UsageSummary): Bucket[] {
  const first = summary.since.slice(0, 10)
  const span = spanDays(summary)
  const size = span > DAILY_BARS_MAX ? 7 : 1
  const bars: Bucket[] = []
  for (let i = 0; i < span; i += size) {
    const start = addDays(first, i)
    const end = addDays(first, Math.min(i + size, span) - 1)
    bars.push({ start, end, tokens: 0, calls: 0, cost: null, costComplete: true })
  }
  for (const day of summary.by_day) {
    const bar =
      bars[Math.floor(Math.round((Date.parse(day.date) - Date.parse(first)) / 86_400_000) / size)]
    if (!bar) continue
    const tokens = day.input_tokens + day.output_tokens
    bar[day.purpose] = (bar[day.purpose] ?? 0) + tokens
    bar.tokens += tokens
    bar.calls += day.calls
    if (day.cost_usd === null) bar.costComplete = bar.costComplete && tokens === 0
    else bar.cost = (bar.cost ?? 0) + day.cost_usd
  }
  return bars
}

function bucketLabel(bar: Pick<Bucket, 'start' | 'end'>): string {
  return bar.start === bar.end
    ? formatDate(bar.start)
    : `${formatDate(bar.start, { short: true })} – ${formatDate(bar.end, { short: true })}`
}

function TooltipFooter({ bar }: { bar: Bucket }) {
  const rows: [string, string][] = [
    [m.ai_usage_tokens(), formatCount(bar.tokens)],
    [m.ai_usage_calls(), formatCount(bar.calls)],
    [m.ai_usage_cost_estimate(), cost(bar.cost, bar.costComplete)],
  ]
  return (
    <div className="mt-1.5 grid basis-full gap-1.5 border-t pt-1.5">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">{label}</span>
          <span className="font-mono font-medium text-foreground tabular-nums">{value}</span>
        </div>
      ))}
    </div>
  )
}

function tooltipLabel(_label: unknown, payload: readonly { payload?: unknown }[]) {
  const bar = payload[0]?.payload as Bucket | undefined
  return bar ? bucketLabel(bar) : null
}

/** One purpose of the hovered bar; after the last one, the bar's totals. */
function tooltipRow(
  value: unknown,
  name: unknown,
  item: { payload?: unknown },
  index: number,
): ReactNode {
  const bar = item.payload as Bucket
  const purpose = name as AiPurpose
  const shown = AI_PURPOSES.filter((p) => bar[p] !== undefined)
  return (
    <>
      <div
        className="size-2.5 shrink-0 rounded-[2px] bg-(--color-bg)"
        style={{ '--color-bg': `var(--color-${purpose})` } as CSSProperties}
      />
      <span className="text-muted-foreground">{PURPOSE_TITLES[purpose]?.() ?? purpose}</span>
      <span className="ml-auto font-mono font-medium text-foreground tabular-nums">
        {formatCount(Number(value))}
      </span>
      {index === shown.length - 1 ? <TooltipFooter bar={bar} /> : null}
    </>
  )
}

function UsageChart({
  summary,
  selected,
  onSelect,
}: {
  summary: UsageSummary
  selected: string | null
  onSelect: (bar: Bucket | null) => void
}) {
  const bars = buckets(summary)
  const used = AI_PURPOSES.filter((p) => summary.by_day.some((d) => d.purpose === p))
  const config: ChartConfig = Object.fromEntries(
    used.map((purpose) => [
      purpose,
      {
        label: PURPOSE_TITLES[purpose](),
        color: `var(--chart-${AI_PURPOSES.indexOf(purpose) + 1})`,
      },
    ]),
  )

  return (
    <ChartContainer
      config={config}
      className="aspect-auto h-52 w-full [&_.recharts-rectangle]:cursor-pointer [&_g]:outline-hidden"
    >
      <BarChart
        data={bars}
        margin={{ left: 0, right: 0, top: 4 }}
        onClick={(state) => {
          const index = state.activeTooltipIndex
          const bar = index === null || index === undefined ? undefined : bars[Number(index)]
          onSelect(!bar || bar.start === selected ? null : bar)
        }}
      >
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="start"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={24}
          tickFormatter={(value: string) => formatDate(value, { short: true })}
        />
        <YAxis
          width={44}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value: number) => formatCount(value, { compact: true })}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              className="min-w-44"
              labelFormatter={tooltipLabel}
              formatter={tooltipRow}
            />
          }
        />
        {used.map((purpose) => (
          <Bar key={purpose} dataKey={purpose} stackId="tokens" fill={`var(--color-${purpose})`}>
            {bars.map((bar) => (
              <Cell
                key={bar.start}
                fillOpacity={selected === null || selected === bar.start ? 1 : 0.35}
              />
            ))}
          </Bar>
        ))}
        <ChartLegend content={<ChartLegendContent />} />
      </BarChart>
    </ChartContainer>
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
/** A usage row with the name shown for its key (a module, a model, a purpose or a day). */
type LabeledRow = UsageRow & { label: string }

const column = createColumnHelper<typeof features, LabeledRow>()

/** The table's grouping, for the first column's header; the columns live outside the table. */
const GroupingContext = createContext<Grouping>('purpose')

function KeyHeader() {
  return GROUP_TITLES[use(GroupingContext)]()
}

type CellProps = CellContext<typeof features, LabeledRow>

const KeyCell = ({ row }: CellProps) => <span className="font-medium">{row.original.label}</span>

const TokensCell = ({ row }: CellProps) => (
  <span
    title={m.ai_usage_tokens_split({
      input: formatCount(row.original.input_tokens),
      output: formatCount(row.original.output_tokens),
    })}
  >
    {formatCount(row.original.input_tokens + row.original.output_tokens)}
  </span>
)

const columns = column.columns([
  column.accessor((r) => r.label, { id: 'key', header: KeyHeader, cell: KeyCell }),
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
    cell: TokensCell,
  }),
  column.accessor((r) => r.cost_usd ?? -1, {
    id: 'cost',
    header: () => m.ai_usage_cost(),
    cell: ({ row }) => cost(row.original.cost_usd),
  }),
])

function UsageTable({ rows, grouping }: { rows: UsageRow[]; grouping: Grouping }) {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'tokens', desc: true }])
  const modules = useModules()
  const moduleName = (id: string) => modules.find((mod) => mod.id === id)?.name()
  const labeled = rows.map((row) => ({ ...row, label: rowLabel(grouping, row.key, moduleName) }))
  const numeric = 'text-right tabular-nums'
  const table = useTable({
    features,
    columns,
    data: labeled,
    getRowId: (row) => row.key,
    state: { sorting },
    onSortingChange: (updater) =>
      setSorting(typeof updater === 'function' ? updater(sorting) : updater),
  })

  return (
    <GroupingContext value={grouping}>
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
    </GroupingContext>
  )
}

/** Over the assistant's calls: other purposes rarely repeat a prompt prefix. */
function chatCacheRate(summary: UsageSummary): string {
  const chat = summary.by_purpose.find((row) => row.key === 'chat')
  return chat && chat.input_tokens > 0 ? formatPercent(chat.cached_tokens / chat.input_tokens) : '—'
}

/** A clicked bar: the details table shows only its days. */
type Selection = { range: UsageRange; start: string; end: string }

/** Account settings → AI → usage over the last 7 or 30 days or all time (M06 §7). Costs are estimates. */
export function UsageSection() {
  const [grouping, setGrouping] = useState<Grouping>('purpose')
  const [range, setRange] = useUiPref<UsageRange>('ai.usage_range', '30')
  const [picked, setPicked] = useState<Selection | null>(null)
  // A bar picked in another range no longer exists.
  const selection = picked?.range === range ? picked : null
  const tz = browserTimeZone()
  const usage = useQuery({
    ...aiUsageSummaryOptions({
      query: { ...(range === 'all' ? {} : { days: Number(range) }), tz },
    }),
    placeholderData: keepPreviousData,
  })
  const detail = useQuery({
    ...aiUsageSummaryOptions({
      query: { start: selection?.start ?? '', end: selection?.end ?? '', tz },
    }),
    enabled: selection !== null,
    placeholderData: keepPreviousData,
  })

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <ToggleGroup
          aria-label={m.ai_usage_range()}
          value={[range]}
          onValueChange={(next) => {
            if (next[0]) setRange(next[0] as UsageRange)
          }}
          className={SEGMENTED}
        >
          {RANGES.map((value) => (
            <ToggleGroupItem key={value} value={value} className={SEGMENT}>
              {RANGE_TITLES[value]()}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <AsyncBoundary query={usage}>
        {(summary) => (
          <div className="space-y-6">
            <dl className="grid grid-cols-2 gap-4 rounded-2xl border p-4 sm:grid-cols-4">
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
                <dt className="text-xs text-muted-foreground">{m.ai_usage_cache_hit_rate()}</dt>
                <dd
                  className="text-lg font-semibold tabular-nums"
                  title={m.ai_usage_cache_hit_rate_hint()}
                >
                  {chatCacheRate(summary)}
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
                  <EmptyTitle>
                    {range === 'all'
                      ? m.ai_usage_empty_all()
                      : m.ai_usage_empty({ days: Number(range) })}
                  </EmptyTitle>
                </EmptyHeader>
              </Empty>
            ) : (
              <>
                <SettingsBlock
                  title={
                    spanDays(summary) > DAILY_BARS_MAX
                      ? m.ai_usage_chart_title_weekly()
                      : m.ai_usage_chart_title()
                  }
                  description={m.ai_usage_chart_hint()}
                >
                  <div className="rounded-2xl border p-4">
                    <UsageChart
                      summary={summary}
                      selected={selection?.start ?? null}
                      onSelect={(bar) =>
                        setPicked(bar ? { range, start: bar.start, end: bar.end } : null)
                      }
                    />
                  </div>
                </SettingsBlock>
                <SettingsBlock
                  title={m.ai_usage_details()}
                  action={
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {selection ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          aria-label={m.ai_usage_filter_clear({ day: bucketLabel(selection) })}
                          onClick={() => setPicked(null)}
                        >
                          {m.ai_usage_filter({ day: bucketLabel(selection) })}
                          <X aria-hidden data-icon="inline-end" />
                        </Button>
                      ) : null}
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
                    </div>
                  }
                >
                  <div className="overflow-hidden rounded-2xl border">
                    <UsageTable
                      key={grouping}
                      grouping={grouping}
                      rows={tableRows(selection && detail.data ? detail.data : summary, grouping)}
                    />
                  </div>
                </SettingsBlock>
              </>
            )}
          </div>
        )}
      </AsyncBoundary>
      <SettingsNote>{m.ai_usage_note()}</SettingsNote>
    </div>
  )
}

function tableRows(summary: UsageSummary, grouping: Grouping): UsageRow[] {
  if (grouping === 'purpose') return summary.by_purpose
  return grouping === 'module' ? summary.by_module : summary.by_model
}
