import type { Gradebook, GradebookSummary } from '@semestra/api-client'
import { createColumnHelper, tableFeatures, useTable } from '@tanstack/react-table'
import { type ReactNode, createContext, useContext, useId, useState } from 'react'
import { Pie, PieChart, Sector, type PieSectorShapeProps } from 'recharts'
import { formatCredits } from '@/lib/format'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Badge } from '@/ui/badge'
import { ChartContainer, ChartTooltip } from '@/ui/chart'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { type CompositionSlice, composition } from '../composition'
import { categoryColor, categoryName, headline, percentText } from '../display'
import { AnimatedPercent } from './AnimatedPercent'
import { GpaValue } from './GpaValue'

const RING = 132
const INNER = 48
const OUTER = 62

type Datum = CompositionSlice & { key: string; name: string; color: string }

const sliceKey = (id: string | null) => id ?? '__none__'

/**
 * One category of the ring: its whole weight lightly tinted, the assumed part darker, the graded
 * part solid. Recharts clones this element with each sector's geometry.
 */
function SliceShape({
  planning,
  hovered,
  ...props
}: Partial<PieSectorShapeProps> & { planning: boolean; hovered: string | null }) {
  const datum = props.payload as Datum | undefined
  const startAngle = props.startAngle ?? 0
  const endAngle = props.endAngle ?? 0
  const base = { cx: props.cx, cy: props.cy, innerRadius: props.innerRadius }
  if (!datum?.color)
    return (
      <Sector
        {...base}
        outerRadius={props.outerRadius}
        startAngle={startAngle}
        endAngle={endAngle}
        fill="var(--muted)"
      />
    )
  const span = endAngle - startAngle
  const share = (part: number) => (datum.weight === 0 ? 0 : part / datum.weight)
  const common = {
    ...base,
    outerRadius: (props.outerRadius ?? 0) + (datum.key === hovered ? 3 : 0),
  }
  const assumedEnd = startAngle + span * share(datum.graded + (planning ? datum.assumed : 0))
  return (
    <g>
      <Sector
        {...common}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={datum.color}
        fillOpacity={0.2}
      />
      {planning && datum.assumed > 0 ? (
        <Sector
          {...common}
          startAngle={startAngle}
          endAngle={assumedEnd}
          fill={datum.color}
          fillOpacity={0.55}
        />
      ) : null}
      {datum.graded > 0 ? (
        <Sector
          {...common}
          startAngle={startAngle}
          endAngle={startAngle + span * share(datum.graded)}
          fill={datum.color}
        />
      ) : null}
    </g>
  )
}

/** A category's figures: the ring's tooltip, the legend row's tooltip and its screen reader text. */
function sliceRows(datum: Datum, planning: boolean): [string, string][] {
  const rows: [string, string][] = [
    [m.grading_slice_weight(), `${formatCredits(datum.weight)}%`],
    [m.grading_slice_graded(), `${formatCredits(datum.graded)}%`],
    [m.grading_average(), percentText(datum.average)],
    [
      m.grading_slice_contribution(),
      `${formatCredits(Math.round(datum.contribution * 100) / 100)}%`,
    ],
  ]
  if (planning) rows.push([m.grading_planned_average(), percentText(datum.plannedAverage)])
  return rows
}

function SliceDetails({
  datum,
  planning,
  mutedClassName,
}: {
  datum: Datum
  planning: boolean
  mutedClassName: string
}) {
  return (
    <div className="grid min-w-40 gap-1.5">
      <div className="flex items-center gap-1.5 font-medium">
        <span
          aria-hidden
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: datum.color }}
        />
        {datum.name}
      </div>
      {sliceRows(datum, planning).map(([label, value]) => (
        <div key={label} className="flex justify-between gap-4">
          <span className={mutedClassName}>{label}</span>
          <span className="font-medium tabular-nums">{value}</span>
        </div>
      ))}
    </div>
  )
}

function SliceTooltip({
  active,
  payload,
  planning,
}: {
  active?: boolean
  payload?: readonly { payload?: unknown }[]
  planning: boolean
}) {
  const datum = payload?.[0]?.payload as Datum | undefined
  if (!active || !datum?.color) return null
  return (
    <div className="rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <SliceDetails datum={datum} planning={planning} mutedClassName="text-muted-foreground" />
    </div>
  )
}

/** What the legend's cells need from the card (column definitions live outside it). */
const LegendContext = createContext({ planning: false, idPrefix: '' })

const detailsIdOf = (idPrefix: string, datum: Datum) => `${idPrefix}-${datum.key}`

function LegendName({ datum }: { datum: Datum }) {
  const { planning, idPrefix } = useContext(LegendContext)
  return (
    <>
      <span
        aria-hidden
        className="mr-2 inline-block size-2.5 rounded-full align-[-0.0625rem]"
        style={{ backgroundColor: datum.color }}
      />
      {datum.name}
      <span id={detailsIdOf(idPrefix, datum)} className="sr-only">
        {sliceRows(datum, planning)
          .map(([label, value]) => `${label}: ${value}`)
          .join(', ')}
      </span>
    </>
  )
}

function AverageHeader() {
  const { planning } = useContext(LegendContext)
  return planning ? m.grading_planned_average() : m.grading_average()
}

function AverageCell({ datum }: { datum: Datum }) {
  const { planning } = useContext(LegendContext)
  return (
    <span className={cn(planning && 'text-primary')}>
      {percentText(planning ? datum.plannedAverage : datum.average)}
    </span>
  )
}

const legendFeatures = tableFeatures({})
const legendColumn = createColumnHelper<typeof legendFeatures, Datum>()

const legendColumns = legendColumn.columns([
  legendColumn.accessor((d) => d.name, {
    id: 'name',
    header: () => m.grading_assessment_category(),
    cell: ({ row }) => <LegendName datum={row.original} />,
  }),
  legendColumn.accessor((d) => d.graded, {
    id: 'graded',
    header: () => m.grading_slice_graded_of_weight(),
    cell: ({ row }) =>
      `${formatCredits(row.original.graded)}/${formatCredits(row.original.weight)}%`,
  }),
  legendColumn.display({
    id: 'average',
    header: () => <AverageHeader />,
    cell: ({ row }) => <AverageCell datum={row.original} />,
  }),
])

const HEAD_CLASS: Record<string, string> = {
  name: 'pl-1.5',
  graded: 'pr-0 pl-2 text-right',
  average: 'pr-1.5 pl-3 text-right',
}
const CELL_CLASS: Record<string, string> = {
  graded: 'py-0 pr-0 pl-2 text-right text-xs text-muted-foreground tabular-nums',
  average: 'rounded-r-md py-0 pr-1.5 pl-3 text-right font-medium tabular-nums',
}

/**
 * One category of the legend. It is the ring's text equivalent: focusable, with the same
 * details as the ring's tooltip on hover or focus and as screen reader text.
 */
function LegendRow({
  datum,
  planning,
  detailsId,
  active,
  onActiveChange,
  children,
}: {
  datum: Datum
  planning: boolean
  detailsId: string
  active: boolean
  onActiveChange: (active: boolean) => void
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <TableRow
            tabIndex={0}
            aria-describedby={detailsId}
            data-active={active ? true : undefined}
            onMouseEnter={() => onActiveChange(true)}
            onMouseLeave={() => onActiveChange(false)}
            onFocus={() => onActiveChange(true)}
            onBlur={() => onActiveChange(false)}
            className="h-8 border-0 outline-none hover:bg-transparent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset data-active:bg-muted/60"
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="left">
        <SliceDetails datum={datum} planning={planning} mutedClassName="text-background/70" />
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * How the course grade is made up (M03 §5.1): a ring with each category's weight, graded part
 * solid, the grade in its middle, GPA and forecast beside it and a row per category below.
 * In plan mode the same card shows the simulated result instead of a separate panel.
 */
export function GradeComposition({
  gradebook,
  planned,
  planning,
}: {
  gradebook: Gradebook
  /** The simulated summary while planning (null until it arrives). */
  planned: GradebookSummary | null
  planning: boolean
}) {
  const [hovered, setHovered] = useState<string | null>(null)
  const idPrefix = useId()
  const { summary: s, scale } = gradebook
  const data: Datum[] = composition(s, planned, gradebook.categories).map((slice) => ({
    ...slice,
    key: sliceKey(slice.id),
    name: slice.category ? categoryName(slice.category) : m.grading_category_none(),
    color: categoryColor(slice.category?.color ?? 'slate'),
  }))

  const legend = useTable({
    features: legendFeatures,
    columns: legendColumns,
    data,
    getRowId: (d) => d.key,
  })

  const shown = headline(s)
  const actual = s.weights_ok || s.overridden ? shown.percentage : null
  const actualLetter = shown.letter
  const actualPoints = shown.points
  // Only a whole result (every item scored or assumed) or a forecast is a planned grade; the
  // average of what has a score so far would read as one.
  const plannedFinal = planned !== null && planned.final_percentage !== null
  const plannedValue = planned ? (planned.final_percentage ?? planned.forecast_percentage) : null
  const plannedLetter = planned
    ? plannedFinal
      ? planned.final_letter
      : planned.forecast_letter
    : null
  const plannedPoints = planned
    ? plannedFinal
      ? planned.final_points
      : planned.forecast_points
    : null
  // Without weights adding up to 100 nothing can be planned, so missing assumptions are not why.
  const unassumed =
    planned && planned.weights_ok && plannedValue === null ? planned.remaining_count : 0
  const shownLetter = planning ? plannedLetter : actualLetter

  return (
    <section
      aria-label={m.grading_composition()}
      data-testid={planning ? 'plan-result' : undefined}
      className="rounded-2xl border border-border p-4"
    >
      <div className="flex items-center gap-4">
        <div className="relative shrink-0" style={{ width: RING, height: RING }}>
          <ChartContainer
            config={{}}
            className="aspect-square size-full"
            initialDimension={{ width: RING, height: RING }}
          >
            <PieChart>
              <ChartTooltip
                cursor={false}
                content={<SliceTooltip planning={planning} />}
                wrapperStyle={{ zIndex: 10 }}
              />
              <Pie
                data={data.length > 0 ? data : [{ key: 'empty', weight: 1 }]}
                dataKey="weight"
                nameKey="name"
                innerRadius={INNER}
                outerRadius={OUTER}
                startAngle={90}
                endAngle={-270}
                paddingAngle={data.length > 1 ? 2 : 0}
                stroke="none"
                isAnimationActive={false}
                onMouseEnter={(_, index) => setHovered(data[index]?.key ?? null)}
                onMouseLeave={() => setHovered(null)}
                shape={<SliceShape planning={planning} hovered={hovered} />}
              />
            </PieChart>
          </ChartContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className={cn('text-xl font-semibold tabular-nums', planning && 'text-primary')}>
              {planning ? percentText(plannedValue) : <AnimatedPercent value={actual} />}
            </span>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              {planning ? (
                m.grading_actual({ value: percentText(actual) })
              ) : s.overridden ? (
                <Badge variant="secondary">{m.grading_overridden()}</Badge>
              ) : shown.final ? (
                m.grading_final()
              ) : (
                m.grading_current()
              )}
            </span>
          </div>
        </div>
        <dl className="grid min-w-0 gap-3">
          <div>
            <dt className="text-xs text-muted-foreground">
              {planning ? m.grading_planned_gpa() : m.grading_gpa()}
            </dt>
            <dd className="flex items-baseline gap-1.5 text-2xl font-semibold tabular-nums">
              <GpaValue
                value={planning ? plannedPoints : actualPoints}
                hidden={scale.hide_gpa}
                letter={shownLetter}
                letterClassName="text-sm font-semibold"
                animated={!planning}
              />
            </dd>
          </div>
          {planning && unassumed > 0 ? (
            <p className="text-xs text-muted-foreground">
              {m.grading_plan_unassumed({ count: unassumed })}
            </p>
          ) : null}
          {/* While planning the planned result is in the middle; the real forecast would read as part of it. */}
          {planning ? null : (
            <div>
              <dt className="text-xs text-muted-foreground">{m.grading_forecast()}</dt>
              <dd className="text-base font-semibold tabular-nums">
                {s.forecast_percentage === null ? (
                  <span className="text-xs font-normal text-muted-foreground">
                    {m.grading_forecast_hint()}
                  </span>
                ) : (
                  <>
                    {percentText(s.forecast_percentage)}
                    {s.forecast_letter && !scale.hide_gpa ? (
                      <span className="ml-1.5 text-sm">{s.forecast_letter}</span>
                    ) : null}
                  </>
                )}
              </dd>
            </div>
          )}
        </dl>
      </div>
      {data.length > 0 ? (
        <LegendContext value={{ planning, idPrefix }}>
          <Table className="mt-3 border-t border-border">
            <TableHeader className="[&_tr]:border-0">
              {legend.getHeaderGroups().map((group) => (
                <TableRow key={group.id} className="hover:bg-transparent">
                  {group.headers.map((h) => (
                    <TableHead
                      key={h.id}
                      scope="col"
                      className={cn(
                        'h-8 text-xs font-normal text-muted-foreground',
                        HEAD_CLASS[h.column.id],
                      )}
                    >
                      <legend.FlexRender header={h} />
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {legend.getRowModel().rows.map((row) => (
                <LegendRow
                  key={row.id}
                  datum={row.original}
                  planning={planning}
                  detailsId={detailsIdOf(idPrefix, row.original)}
                  active={hovered === row.id}
                  onActiveChange={(on) => setHovered(on ? row.id : null)}
                >
                  {row.getAllCells().map((cell) =>
                    cell.column.id === 'name' ? (
                      <TableHead
                        key={cell.id}
                        scope="row"
                        className="h-8 w-full max-w-0 truncate rounded-l-md pr-0 pl-1.5 font-normal"
                      >
                        <legend.FlexRender cell={cell} />
                      </TableHead>
                    ) : (
                      <TableCell key={cell.id} className={CELL_CLASS[cell.column.id]}>
                        <legend.FlexRender cell={cell} />
                      </TableCell>
                    ),
                  )}
                </LegendRow>
              ))}
            </TableBody>
          </Table>
        </LegendContext>
      ) : null}
    </section>
  )
}
