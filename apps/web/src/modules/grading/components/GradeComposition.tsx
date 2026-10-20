import type { Gradebook, GradebookSummary } from '@semestra/api-client'
import { useState } from 'react'
import { Pie, PieChart, Sector, type PieSectorShapeProps } from 'recharts'
import { formatCredits } from '@/lib/format'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Badge } from '@/ui/badge'
import { ChartContainer, ChartTooltip } from '@/ui/chart'
import { type CompositionSlice, composition } from '../composition'
import { categoryColor, categoryName, percentText } from '../display'
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
  if (!active || !datum) return null
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
  return (
    <div className="grid min-w-40 gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <div className="flex items-center gap-1.5 font-medium">
        <span
          aria-hidden
          className="size-2.5 rounded-full"
          style={{ backgroundColor: datum.color }}
        />
        {datum.name}
      </div>
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-4">
          <span className="text-muted-foreground">{label}</span>
          <span className="font-medium tabular-nums">{value}</span>
        </div>
      ))}
    </div>
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
  assumed,
}: {
  gradebook: Gradebook
  /** The simulated summary while planning (null until it arrives). */
  planned: GradebookSummary | null
  planning: boolean
  /** Active assumed scores in percent per assessment id. */
  assumed: Readonly<Record<string, number>>
}) {
  const [hovered, setHovered] = useState<string | null>(null)
  const { summary: s, scale } = gradebook
  const data: Datum[] = composition(gradebook.assessments, gradebook.categories, assumed).map(
    (slice) => ({
      ...slice,
      key: sliceKey(slice.id),
      name: slice.category ? categoryName(slice.category) : m.grading_category_none(),
      color: categoryColor(slice.category?.color ?? 'slate'),
    }),
  )

  const actual = s.weights_ok || s.overridden ? (s.final_percentage ?? s.current_percentage) : null
  const actualLetter = s.final_percentage === null ? s.current_letter : s.final_letter
  const actualPoints = s.final_percentage === null ? s.current_points : s.final_points
  const plannedValue = planned
    ? (planned.final_percentage ?? planned.forecast_percentage ?? planned.current_percentage)
    : null
  const plannedLetter = planned
    ? (planned.final_letter ?? planned.forecast_letter ?? planned.current_letter)
    : null
  const plannedPoints = planned
    ? (planned.final_points ?? planned.forecast_points ?? planned.current_points)
    : null
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
              ) : s.final_percentage === null ? (
                m.grading_current()
              ) : (
                m.grading_final()
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
                animated={!planning}
              />
              {shownLetter ? <span className="text-sm font-semibold">{shownLetter}</span> : null}
            </dd>
          </div>
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
                  {s.forecast_letter ? (
                    <span className="ml-1.5 text-sm">{s.forecast_letter}</span>
                  ) : null}
                </>
              )}
            </dd>
          </div>
        </dl>
      </div>
      {data.length > 0 ? (
        <table className="mt-3 w-full border-t border-border text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground">
              <th scope="col" className="h-8 pl-1.5 text-left font-normal">
                {m.grading_assessment_category()}
              </th>
              <th scope="col" className="h-8 pl-2 text-right font-normal whitespace-nowrap">
                {m.grading_slice_graded_of_weight()}
              </th>
              <th scope="col" className="h-8 pr-1.5 pl-3 text-right font-normal whitespace-nowrap">
                {planning ? m.grading_planned_average() : m.grading_average()}
              </th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr
                key={d.key}
                data-active={hovered === d.key ? true : undefined}
                onMouseEnter={() => setHovered(d.key)}
                onMouseLeave={() => setHovered(null)}
                className="h-8 data-active:bg-muted/60"
              >
                <th
                  scope="row"
                  className="w-full max-w-0 truncate rounded-l-md pl-1.5 text-left font-normal"
                >
                  <span
                    aria-hidden
                    className="mr-2 inline-block size-2.5 rounded-full align-[-0.0625rem]"
                    style={{ backgroundColor: d.color }}
                  />
                  {d.name}
                </th>
                <td className="pl-2 text-right text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                  {formatCredits(d.graded)}/{formatCredits(d.weight)}%
                </td>
                <td
                  className={cn(
                    'rounded-r-md pr-1.5 pl-3 text-right font-medium tabular-nums',
                    planning && 'text-primary',
                  )}
                >
                  {percentText(planning ? d.plannedAverage : d.average)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  )
}
