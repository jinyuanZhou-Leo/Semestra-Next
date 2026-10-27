import type { DataCounts, FilesUsageBreakdown, StorageUsage } from '@semestra/api-client'
import {
  agentMemoryListOptions,
  coreStorageGetOptions,
  filesUsageBreakdownOptions,
  portabilityDataCountGetOptions,
} from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { createColumnHelper, tableFeatures, useTable } from '@tanstack/react-table'
import {
  Bot,
  CalendarCheck,
  ChartPie,
  FileText,
  GraduationCap,
  type LucideIcon,
  NotebookPen,
} from 'lucide-react'
import { createContext, use, useState } from 'react'
import { Label, Pie, PieChart } from 'recharts'
import { SettingsBlock, SettingsGroup, SettingsNote } from '@/app/settings'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { formatBytes, formatCount, formatPercent } from '@/lib/format'
import { SEGMENT, SEGMENTED } from '@/lib/segmented'
import { subjectColor } from '@/lib/subject-color'
import { m } from '@/paraglide/messages'
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/ui/chart'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/ui/item'
import { Progress } from '@/ui/progress'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group'

// Account settings → Data → storage against the quota and how much data the account holds
// (M13 §7). The quota covers what modules store (`core.storage.get`): course files, Sem
// attachments, uploads waiting in an import. Nothing here pushes an event, so it asks again on open.

const FRESH = { refetchOnMount: 'always' } as const

/** Storage modules in the order they are drawn; others (none today) follow under their id. */
const MODULES: Record<string, { label: () => string; color: string }> = {
  files: { label: m.portability_storage_module_files, color: 'var(--chart-4)' },
  agent: { label: m.portability_storage_module_agent, color: 'var(--chart-2)' },
  imports: { label: m.portability_storage_module_imports, color: 'var(--chart-1)' },
}
const OTHER_MODULE_COLOR = 'var(--chart-3)'
const FREE_COLOR = 'var(--muted)'

/** Row of the usage table for files counted in another table than `files_items`. */
const MODULE_FILE_TABLES: Record<string, string> = {
  agent: 'agent_attachments',
  imports: 'imports_uploads',
}

function moduleInfo(id: string) {
  return MODULES[id] ?? { label: () => id, color: OTHER_MODULE_COLOR }
}

/** Modules with something stored, known ones first. */
function storedModules(usage: StorageUsage): [string, number][] {
  const order = Object.keys(MODULES)
  return Object.entries(usage.by_module)
    .filter(([, bytes]) => bytes > 0)
    .sort(([a], [b]) => {
      const ia = order.indexOf(a)
      const ib = order.indexOf(b)
      return (ia < 0 ? order.length : ia) - (ib < 0 ? order.length : ib) || a.localeCompare(b)
    })
}

function Swatch({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="size-2.5 shrink-0 rounded-[3px] ring-1 ring-border ring-inset"
      style={{ background: color }}
    />
  )
}

// --- the ring ----------------------------------------------------------------------------------

type Slice = { key: string; label: string; bytes: number; fill: string }

function slices(usage: StorageUsage): Slice[] {
  const used = storedModules(usage).map(([id, bytes]) => ({
    key: id,
    label: moduleInfo(id).label(),
    bytes,
    fill: moduleInfo(id).color,
  }))
  const free = usage.quota_bytes > 0 ? Math.max(0, usage.quota_bytes - usage.used_bytes) : 0
  if (free > 0) {
    used.push({ key: 'free', label: m.portability_storage_free(), bytes: free, fill: FREE_COLOR })
  }
  return used
}

function sliceRow(value: unknown, _name: unknown, item: { payload?: unknown }) {
  const slice = item.payload as Slice
  return (
    <div className="flex w-full items-center gap-2">
      <Swatch color={slice.fill} />
      <span className="text-muted-foreground">{slice.label}</span>
      <span className="ml-auto font-mono font-medium text-foreground tabular-nums">
        {formatBytes(Number(value))}
      </span>
    </div>
  )
}

/** The ring's middle: the share used, or the bytes used without a quota. Recharts adds `viewBox`. */
function RingCenter({ text, viewBox }: { text: string; viewBox?: { cx?: number; cy?: number } }) {
  if (viewBox?.cx === undefined || viewBox.cy === undefined) return null
  const { cx, cy } = viewBox
  return (
    <text x={cx} y={cy} textAnchor="middle">
      <tspan x={cx} y={cy - 2} className="fill-foreground font-heading text-2xl font-semibold">
        {text}
      </tspan>
      <tspan x={cx} y={cy + 20} className="fill-muted-foreground text-xs">
        {m.portability_storage_used()}
      </tspan>
    </text>
  )
}

function StorageRing({ usage }: { usage: StorageUsage }) {
  const parts = slices(usage)
  const limited = usage.quota_bytes > 0
  // An empty account still gets its (empty) ring.
  const data = parts.length > 0 ? parts : [{ key: 'free', label: '', bytes: 1, fill: FREE_COLOR }]
  const config: ChartConfig = Object.fromEntries(
    parts.map((p) => [p.key, { label: p.label, color: p.fill }]),
  )
  const center = limited
    ? formatPercent(usage.used_bytes / usage.quota_bytes, 0)
    : formatBytes(usage.used_bytes)
  const used = formatBytes(usage.used_bytes)
  return (
    <figure>
      <figcaption className="sr-only">
        {limited
          ? m.portability_storage_chart_label({ used, quota: formatBytes(usage.quota_bytes) })
          : m.portability_storage_chart_label_unlimited({ used })}
      </figcaption>
      <ChartContainer config={config} className="aspect-square h-44">
        <PieChart>
          {parts.length > 0 ? (
            <ChartTooltip
              cursor={false}
              content={<ChartTooltipContent hideLabel formatter={sliceRow} />}
            />
          ) : null}
          <Pie
            data={data}
            dataKey="bytes"
            nameKey="key"
            innerRadius={58}
            outerRadius={80}
            strokeWidth={3}
            startAngle={90}
            endAngle={-270}
            isAnimationActive={false}
          >
            <Label content={<RingCenter text={center} />} />
          </Pie>
        </PieChart>
      </ChartContainer>
    </figure>
  )
}

function StorageSummary({ usage }: { usage: StorageUsage }) {
  const parts = slices(usage)
  return (
    <div className="grid items-center gap-6 rounded-2xl border p-4 sm:grid-cols-[11rem_1fr]">
      <StorageRing usage={usage} />
      <div className="grid gap-2.5 text-sm">
        <dl className="contents">
          {parts.map((part) => (
            <div key={part.key} className="flex items-center gap-2">
              <Swatch color={part.fill} />
              <dt className="text-muted-foreground">{part.label}</dt>
              <dd className="ml-auto tabular-nums">{formatBytes(part.bytes)}</dd>
            </div>
          ))}
          <div className="flex items-center gap-2 border-t pt-2.5">
            <dt className="font-medium">{m.portability_storage_quota()}</dt>
            <dd className="ml-auto font-medium tabular-nums">
              {usage.quota_bytes > 0
                ? formatBytes(usage.quota_bytes)
                : m.portability_storage_unlimited()}
            </dd>
          </div>
        </dl>
        <SettingsNote>{m.portability_storage_hint()}</SettingsNote>
      </div>
    </div>
  )
}

// --- usage details -------------------------------------------------------------------------------

type Grouping = 'course' | 'type'

/** Courses beyond these are added up in one row. */
const SHOWN_COURSES = 5

const TYPE_TITLES: Record<FilesUsageBreakdown['by_type'][number]['type'], () => string> = {
  pdf: m.portability_storage_type_pdf,
  image: m.portability_storage_type_image,
  office: m.portability_storage_type_office,
  text: m.portability_storage_type_text,
  other: m.portability_storage_type_other,
}

/** File types take palette hues, so they don't read as the ring's storage modules. */
const TYPE_COLORS: Record<keyof typeof TYPE_TITLES, string> = {
  pdf: 'var(--subject-1)',
  image: 'var(--subject-4)',
  office: 'var(--subject-7)',
  text: 'var(--subject-10)',
  other: 'var(--muted-foreground)',
}

type UsageRow = {
  key: string
  name: string
  color: string
  files: number | null
  bytes: number
  share: number
}

function usageRows(
  grouping: Grouping,
  usage: StorageUsage,
  breakdown: FilesUsageBreakdown,
  counts: DataCounts | undefined,
): UsageRow[] {
  const share = (bytes: number) => (usage.used_bytes > 0 ? bytes / usage.used_bytes : 0)
  const rows: UsageRow[] = []
  if (grouping === 'course') {
    const courses = breakdown.by_course
    const shown = courses.length > SHOWN_COURSES + 1 ? courses.slice(0, SHOWN_COURSES) : courses
    for (const c of shown) {
      rows.push({
        key: c.course_id,
        name: c.name,
        color: subjectColor(c.color),
        files: c.files,
        bytes: c.bytes,
        share: share(c.bytes),
      })
    }
    const rest = courses.slice(shown.length)
    if (rest.length > 0) {
      const bytes = rest.reduce((sum, c) => sum + c.bytes, 0)
      rows.push({
        key: 'other-courses',
        name: m.portability_storage_other_courses({ count: formatCount(rest.length) }),
        color: 'var(--muted-foreground)',
        files: rest.reduce((sum, c) => sum + c.files, 0),
        bytes,
        share: share(bytes),
      })
    }
  } else {
    for (const t of breakdown.by_type) {
      rows.push({
        key: t.type,
        name: TYPE_TITLES[t.type](),
        color: TYPE_COLORS[t.type],
        files: t.files,
        bytes: t.bytes,
        share: share(t.bytes),
      })
    }
  }
  // What other modules store follows the course files, in either grouping.
  for (const [id, bytes] of storedModules(usage)) {
    if (id === 'files') continue
    const table = MODULE_FILE_TABLES[id]
    rows.push({
      key: `module-${id}`,
      name: moduleInfo(id).label(),
      color: moduleInfo(id).color,
      files: table ? (counts?.tables[table] ?? null) : null,
      bytes,
      share: share(bytes),
    })
  }
  return rows
}

const features = tableFeatures({})
const column = createColumnHelper<typeof features, UsageRow>()

/** The table's grouping, for the first column's header; the columns live outside the table. */
const GroupingContext = createContext<Grouping>('course')

function NameHeader() {
  return use(GroupingContext) === 'course'
    ? m.portability_storage_col_course()
    : m.portability_storage_col_type()
}

const columns = column.columns([
  column.accessor((r) => r.name, {
    id: 'name',
    header: NameHeader,
    cell: ({ row }) => (
      <div className="flex min-w-0 items-center gap-2 font-medium">
        <Swatch color={row.original.color} />
        <span className="truncate">{row.original.name}</span>
      </div>
    ),
  }),
  column.accessor((r) => r.files, {
    id: 'files',
    header: () => m.portability_storage_col_files(),
    cell: ({ row }) => (row.original.files === null ? '—' : formatCount(row.original.files)),
  }),
  column.accessor((r) => r.share, {
    id: 'share',
    header: () => m.portability_storage_col_share(),
    cell: ({ row }) => (
      <Progress
        value={row.original.share * 100}
        aria-label={formatPercent(row.original.share)}
        className="h-1.5"
      />
    ),
  }),
  column.accessor((r) => r.bytes, {
    id: 'bytes',
    header: () => m.portability_storage_col_size(),
    cell: ({ row }) => formatBytes(row.original.bytes),
  }),
])

const CELL_CLASS: Record<string, string> = {
  name: 'w-full max-w-0 pl-4',
  files: 'text-right tabular-nums',
  share: 'w-40 min-w-28',
  bytes: 'pr-4 text-right whitespace-nowrap tabular-nums',
}

function UsageTable({ rows, grouping }: { rows: UsageRow[]; grouping: Grouping }) {
  const table = useTable({ features, columns, data: rows, getRowId: (row) => row.key })
  return (
    <GroupingContext value={grouping}>
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((h) => (
                <TableHead key={h.id} className={CELL_CLASS[h.column.id]}>
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
                <TableCell key={cell.id} className={CELL_CLASS[cell.column.id]}>
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

function UsageDetails({ usage }: { usage: StorageUsage }) {
  const [grouping, setGrouping] = useState<Grouping>('course')
  const breakdown = useQuery({ ...filesUsageBreakdownOptions(), ...FRESH })
  const counts = useQuery({ ...portabilityDataCountGetOptions(), ...FRESH })
  return (
    <SettingsBlock
      title={m.portability_storage_details()}
      action={
        usage.used_bytes > 0 ? (
          <ToggleGroup
            aria-label={m.portability_storage_details()}
            value={[grouping]}
            onValueChange={(next) => {
              if (next[0]) setGrouping(next[0] as Grouping)
            }}
            className={SEGMENTED}
          >
            <ToggleGroupItem value="course" className={SEGMENT}>
              {m.portability_storage_by_course()}
            </ToggleGroupItem>
            <ToggleGroupItem value="type" className={SEGMENT}>
              {m.portability_storage_by_type()}
            </ToggleGroupItem>
          </ToggleGroup>
        ) : null
      }
    >
      {usage.used_bytes === 0 ? (
        <Empty className="rounded-2xl border border-solid border-border p-6">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ChartPie aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{m.portability_storage_empty()}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <AsyncBoundary query={breakdown}>
          {(data) => (
            <div className="overflow-hidden rounded-2xl border">
              <UsageTable
                grouping={grouping}
                rows={usageRows(grouping, usage, data, counts.data)}
              />
            </div>
          )}
        </AsyncBoundary>
      )}
    </SettingsBlock>
  )
}

// --- data overview -------------------------------------------------------------------------------

type OverviewRow = {
  id: string
  icon: LucideIcon
  title: () => string
  /** Tables counted on the row, with their labels. */
  tables: [string, () => string][]
}

const OVERVIEW: OverviewRow[] = [
  {
    id: 'academics',
    icon: GraduationCap,
    title: m.portability_storage_row_academics,
    tables: [
      ['academics_programs', m.portability_entity_academics_programs],
      ['academics_terms', m.portability_entity_academics_terms],
      ['academics_courses', m.portability_entity_academics_courses],
    ],
  },
  {
    id: 'grades',
    icon: NotebookPen,
    title: m.portability_storage_row_grades,
    tables: [
      ['grading_assessments', m.portability_entity_grading_assessments],
      ['grading_categories', m.portability_entity_grading_categories],
    ],
  },
  {
    id: 'plans',
    icon: CalendarCheck,
    title: m.portability_storage_row_plans,
    tables: [
      ['tasks_items', m.portability_entity_tasks_items],
      ['schedule_events', m.portability_entity_schedule_events],
      ['schedule_meetings', m.portability_entity_schedule_meetings],
    ],
  },
  {
    id: 'files',
    icon: FileText,
    title: m.portability_storage_row_files,
    tables: [
      ['files_items', m.portability_entity_files_items],
      ['files_folders', m.portability_entity_files_folders],
    ],
  },
  {
    id: 'sem',
    icon: Bot,
    title: m.portability_storage_row_sem,
    tables: [['agent_sessions', m.portability_entity_agent_sessions]],
  },
]

function countLine(counts: DataCounts, tables: OverviewRow['tables']): string[] {
  return tables.map(([table, label]) =>
    m.portability_storage_count({ label: label(), count: formatCount(counts.tables[table] ?? 0) }),
  )
}

function DataOverview() {
  const counts = useQuery({ ...portabilityDataCountGetOptions(), ...FRESH })
  const memories = useQuery({ ...agentMemoryListOptions(), ...FRESH })
  return (
    <SettingsBlock
      title={m.portability_storage_overview()}
      description={m.portability_storage_overview_desc()}
    >
      <AsyncBoundary query={counts}>
        {(data) => (
          <SettingsGroup>
            {OVERVIEW.map((row) => {
              const Icon = row.icon
              const parts = countLine(data, row.tables)
              const memory = row.id === 'sem' ? memories.data : undefined
              if (memory) {
                parts.push(
                  m.portability_storage_memories({
                    count: formatCount(memory.items.length),
                    limit: formatCount(memory.limit),
                  }),
                )
              }
              return (
                <Item key={row.id}>
                  <ItemMedia variant="icon">
                    <Icon aria-hidden />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{row.title()}</ItemTitle>
                    <ItemDescription>{parts.join(' · ')}</ItemDescription>
                  </ItemContent>
                  {memory ? (
                    <ItemActions className="w-32">
                      <Progress
                        value={(memory.items.length / memory.limit) * 100}
                        aria-label={m.portability_storage_memories({
                          count: formatCount(memory.items.length),
                          limit: formatCount(memory.limit),
                        })}
                        className="h-1.5 w-full"
                      />
                    </ItemActions>
                  ) : null}
                </Item>
              )
            })}
          </SettingsGroup>
        )}
      </AsyncBoundary>
    </SettingsBlock>
  )
}

export function StorageSection() {
  const usage = useQuery({ ...coreStorageGetOptions(), ...FRESH })
  return (
    <AsyncBoundary query={usage}>
      {(data) => (
        <div className="space-y-6">
          <StorageSummary usage={data} />
          <UsageDetails usage={data} />
          <DataOverview />
        </div>
      )}
    </AsyncBoundary>
  )
}
