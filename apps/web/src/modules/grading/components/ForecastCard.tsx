import type { Gradebook, GradebookSummary } from '@semestra/api-client'
import type { ReactNode } from 'react'
import { Bar, BarChart, Cell, LabelList, usePlotArea, XAxis, YAxis } from 'recharts'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { type ChartConfig, ChartContainer, ChartTooltip } from '@/ui/chart'
import { categoryColor, categoryName, percentText } from '../display'
import type { WhatIf } from '../whatif'
import { GpaValue } from './GpaValue'

/** A row: the name and value on one line, the bar under them. */
const ROW = 34
const BAR = 8
const LINE = 16

type Datum = {
  id: string
  title: string
  value: number
  color: string
  category: string
  /** assumed: typed in plan mode; average: the category has no score yet, so the course average. */
  source: 'assumed' | 'category' | 'average'
}

const config = { value: { label: '' } } satisfies ChartConfig

function ForecastTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: ReadonlyArray<{ payload?: unknown }>
}) {
  const d = active ? (payload?.[0]?.payload as Datum | undefined) : undefined
  if (!d) return null
  return (
    <div className="grid min-w-36 gap-1 rounded-lg border bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <div className="flex items-center gap-1.5 font-medium">
        <span aria-hidden className="size-2.5 rounded-full" style={{ backgroundColor: d.color }} />
        {d.title}
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">
          {d.source === 'assumed'
            ? m.grading_assumed_score()
            : d.source === 'average'
              ? m.grading_forecast_from_course()
              : m.grading_forecast_from_category({ category: d.category })}
        </span>
        <span className="font-medium tabular-nums">{percentText(d.value)}</span>
      </div>
    </div>
  )
}

/**
 * A row's name (cut to one line) and predicted value just above its bar, and where the bar has to
 * reach for the target. Recharts clones this element with the bar's geometry.
 */
function RowLabel({
  y,
  index,
  data,
  required,
}: {
  y?: number | string
  index?: number
  data: Datum[]
  required: number | null
}) {
  const area = usePlotArea()
  const d = index === undefined ? undefined : data[index]
  if (!area || !d || y === undefined) return null
  const top = Number(y)
  const mark = required === null ? null : area.x + (area.width * Math.min(required, 100)) / 100
  return (
    <g>
      <foreignObject x={area.x} y={top - LINE - 2} width={area.width} height={LINE}>
        <div className="flex items-center justify-between gap-3 text-xs leading-4">
          <span className="truncate text-muted-foreground">{d.title}</span>
          <span className="shrink-0 font-medium tabular-nums">{percentText(d.value)}</span>
        </div>
      </foreignObject>
      {mark === null ? null : (
        <line
          x1={mark}
          x2={mark}
          y1={top - 2}
          y2={top + BAR + 2}
          className="stroke-foreground"
          strokeWidth={2}
          strokeLinecap="round"
        />
      )}
    </g>
  )
}

/**
 * The predicted final grade and what each remaining assessment is predicted to score, against
 * the average the target needs. In plan mode the same card shows the plan: assumed scores
 * replace the predictions they cover.
 */
export function ForecastCard({
  gradebook,
  planning,
  planned,
  whatIf,
  footer,
}: {
  gradebook: Gradebook
  planning: boolean
  planned: GradebookSummary | null
  whatIf: WhatIf
  /** The target picker below the chart. */
  footer?: ReactNode
}) {
  const { summary: real, scale } = gradebook
  const s = planning ? (planned ?? real) : real
  const categories = new Map(gradebook.categories.map((c) => [c.id, c]))
  // In plan mode assumed scores count as a category's history, so the plan's own list applies.
  const fromAverage = new Set(s.missing_history_category_ids)
  const data: Datum[] = gradebook.assessments
    .filter((a) => a.score_percentage === null && !a.dropped && a.weight > 0)
    .toSorted((a, b) => a.position - b.position)
    .flatMap((a) => {
      const assumed = planning ? whatIf.scores[a.id] : undefined
      const value = assumed ?? s.predictions[a.id]
      if (value === undefined) return []
      const category = a.category_id ? categories.get(a.category_id) : undefined
      return [
        {
          id: a.id,
          title: a.title,
          value: Math.round(value * 10) / 10,
          color: categoryColor(category?.color ?? 'slate'),
          category: category ? categoryName(category) : m.grading_category_none(),
          source:
            assumed !== undefined
              ? 'assumed'
              : fromAverage.has(a.category_id ?? null)
                ? 'average'
                : 'category',
        },
      ]
    })
  const final = s.final_percentage !== null
  const value = final ? s.final_percentage : s.forecast_percentage
  const letter = final ? s.final_letter : s.forecast_letter
  const points = final ? s.final_points : s.forecast_points
  const required = s.reachable === false ? null : s.required_average
  const target = required !== null && required > 0 ? required : null

  return (
    <section
      aria-label={planning ? m.grading_planned_grade() : m.grading_forecast()}
      className="rounded-2xl border border-border p-4"
    >
      <p className="text-xs text-muted-foreground">
        {planning ? m.grading_planned_grade() : m.grading_forecast()}
      </p>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums">{percentText(value)}</span>
        <span className="flex items-baseline gap-1 text-sm font-semibold tabular-nums">
          {scale.hide_gpa ? (
            <span className="text-xs font-normal text-muted-foreground">{m.grading_gpa()}</span>
          ) : null}
          <GpaValue
            value={points}
            hidden={scale.hide_gpa}
            letter={letter}
            letterClassName="text-sm font-semibold"
          />
        </span>
      </div>
      {data.length > 0 ? (
        <>
          <ChartContainer
            config={config}
            className="mt-3 aspect-auto w-full"
            style={{ height: data.length * ROW }}
            initialDimension={{ width: 280, height: data.length * ROW }}
          >
            <BarChart
              accessibilityLayer
              data={data}
              layout="vertical"
              margin={{ top: LINE - (ROW - BAR) / 2 + 2, right: 0, bottom: 0, left: 0 }}
              barSize={BAR}
            >
              <XAxis type="number" domain={[0, 100]} hide />
              <YAxis type="category" dataKey="title" hide />
              <ChartTooltip cursor={false} content={ForecastTooltip} />
              <Bar
                dataKey="value"
                radius={4}
                background={{ className: 'fill-muted', radius: 4 }}
                isAnimationActive={false}
              >
                {data.map((d) => (
                  <Cell key={d.id} fill={d.color} fillOpacity={d.source === 'assumed' ? 1 : 0.45} />
                ))}
                <LabelList dataKey="value" content={<RowLabel data={data} required={target} />} />
              </Bar>
            </BarChart>
          </ChartContainer>
          {/* Kept in place without a target (met or out of reach), so the card keeps its height. */}
          <p
            aria-hidden={target === null}
            className={cn(
              'mt-1 flex items-center gap-1.5 text-xs text-muted-foreground',
              target === null && 'invisible',
            )}
          >
            <span aria-hidden className="h-3 w-0.5 rounded-full bg-foreground" />
            {m.grading_forecast_needed({ value: percentText(target ?? 0) })}
          </p>
        </>
      ) : null}
      {footer}
    </section>
  )
}
