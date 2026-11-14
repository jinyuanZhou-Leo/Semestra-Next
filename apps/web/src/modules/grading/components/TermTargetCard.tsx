import type { CourseGrade, TermGrades, TermGradeSimulation } from '@semestra/api-client'
import { useId, useState } from 'react'
import { Bar, BarChart, Cell, LabelList, ReferenceLine, XAxis, YAxis } from 'recharts'
import { formatGpa } from '@/lib/format'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { type ChartConfig, ChartContainer, ChartTooltip } from '@/ui/chart'
import { Field, FieldDescription, FieldLabel } from '@/ui/field'
import { Input } from '@/ui/input'
import { percentText } from '../display'
import { parseDecimal } from '../score'
import { Concealed, ConcealedChart, GpaValue } from './GradeValue'

const ROW = 26
const config = { value: { label: '' } } satisfies ChartConfig

type Datum = { id: string; name: string; value: number; color: string; assumed: boolean }

function TermTooltip({
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
      <div className="font-medium">{d.name}</div>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">
          {d.assumed ? m.grading_assumed_score() : m.grading_current()}
        </span>
        <span className="font-medium tabular-nums">{percentText(d.value)}</span>
      </div>
    </div>
  )
}

/** The goal typed as text; an empty field clears it, anything else waits until it parses. */
function TargetField({
  targetGpa,
  maxPoints,
  onChange,
}: {
  targetGpa: number | null
  maxPoints: number
  onChange: (targetGpa: number | null) => void
}) {
  const id = useId()
  const [text, setText] = useState(targetGpa === null ? '' : String(targetGpa))
  const value = text.trim() === '' ? null : parseDecimal(text)
  const invalid = text.trim() !== '' && (value === null || value > maxPoints)
  return (
    <Field data-invalid={invalid || undefined}>
      <FieldLabel htmlFor={id}>{m.grading_term_target()}</FieldLabel>
      <Input
        id={id}
        inputMode="decimal"
        placeholder={m.grading_term_target_placeholder({ max: formatGpa(maxPoints, 1) })}
        aria-invalid={invalid || undefined}
        value={text}
        onChange={(event) => {
          const next = event.target.value
          setText(next)
          const parsed = next.trim() === '' ? null : parseDecimal(next)
          if (next.trim() === '' || (parsed !== null && parsed <= maxPoints)) onChange(parsed)
        }}
      />
    </Field>
  )
}

/**
 * The term's goal and how far the unfinished courses are from it: a bar per unfinished course
 * (its average so far, or the assumed final percentage in plan mode) against the percentage they
 * need. In plan mode the card leads with the planned GPA.
 */
export function TermTargetCard({
  term,
  planning,
  planned,
  scores,
  targetGpa,
  colors,
  label,
  canAssume,
  onTargetChange,
}: {
  term: TermGrades
  planning: boolean
  /** The simulation: with a target, or in plan mode (null until it arrives). */
  planned: TermGradeSimulation | null
  scores: Readonly<Record<string, number>>
  targetGpa: number | null
  colors: ReadonlyMap<string, string>
  label: (c: CourseGrade) => string
  canAssume: (c: CourseGrade) => boolean
  onTargetChange: (targetGpa: number | null) => void
}) {
  const data: Datum[] = term.courses.filter(canAssume).flatMap((c) => {
    const assumed = planning ? scores[c.course_id] : undefined
    const value = assumed ?? c.current_percentage
    if (value === null || value === undefined) return []
    return [
      {
        id: c.course_id,
        name: label(c),
        value: Math.round(value * 10) / 10,
        color: colors.get(c.course_id) ?? 'var(--muted-foreground)',
        assumed: assumed !== undefined,
      },
    ]
  })
  const gap = planned?.gap ?? null
  // Once the goal is met nothing more is needed.
  const required =
    planned?.target_gpa != null && !(gap !== null && gap <= 0) ? planned.required_percentage : null
  const status =
    targetGpa === null || planned === null || planned.target_gpa === null
      ? null
      : planned.reachable === false
        ? { tone: 'bad', text: m.grading_target_out_of_reach() }
        : gap !== null && gap <= 0
          ? { tone: 'good', text: m.grading_target_met() }
          : required !== null
            ? {
                tone: 'muted',
                text: m.grading_term_required({ percentage: percentText(required) }),
              }
            : gap !== null
              ? {
                  tone: 'bad',
                  text: m.grading_target_gap({ gap: formatGpa(gap) }),
                }
              : null

  const height = data.length * ROW + 24

  return (
    <section
      aria-label={planning ? m.grading_planned_gpa() : m.grading_term_unfinished()}
      data-testid="term-plan-result"
      className="rounded-2xl border border-border p-4"
    >
      {planning ? (
        <>
          <p className="text-xs text-muted-foreground">{m.grading_planned_gpa()}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            <GpaValue value={planned?.gpa ?? null} />
          </p>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">{m.grading_term_unfinished()}</p>
      )}
      {data.length > 0 ? (
        <ConcealedChart className="mt-3" height={height}>
          <ChartContainer
            config={config}
            className="aspect-auto w-full"
            style={{ height }}
            initialDimension={{ width: 280, height }}
          >
            <BarChart
              accessibilityLayer
              data={data}
              layout="vertical"
              margin={{ top: 18, right: 36, bottom: 0, left: 0 }}
              barCategoryGap={6}
            >
              <XAxis type="number" domain={[0, 100]} hide />
              <YAxis
                type="category"
                dataKey="name"
                width={84}
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 12 }}
              />
              <ChartTooltip cursor={false} content={TermTooltip} />
              <Bar dataKey="value" radius={4} isAnimationActive={false}>
                {data.map((d) => (
                  <Cell key={d.id} fill={d.color} fillOpacity={d.assumed ? 1 : 0.45} />
                ))}
                <LabelList
                  dataKey="value"
                  position="right"
                  className="fill-foreground text-xs tabular-nums"
                  formatter={(v: unknown) => percentText(Number(v))}
                />
              </Bar>
              {required !== null && required > 0 && required <= 100 ? (
                <ReferenceLine
                  x={required}
                  stroke="var(--foreground)"
                  strokeDasharray="3 3"
                  label={{
                    value: m.grading_forecast_needed({ value: percentText(required) }),
                    position: 'top',
                    fontSize: 11,
                    fill: 'var(--muted-foreground)',
                  }}
                />
              ) : null}
            </BarChart>
          </ChartContainer>
        </ConcealedChart>
      ) : null}
      <div className="mt-3 space-y-2 border-t border-border pt-3">
        <TargetField targetGpa={targetGpa} maxPoints={term.max_points} onChange={onTargetChange} />
        {status ? (
          <FieldDescription
            className={cn(
              status.tone === 'bad' && 'text-destructive',
              status.tone === 'good' && 'text-foreground',
            )}
          >
            <Concealed>{status.text}</Concealed>
          </FieldDescription>
        ) : null}
      </div>
    </section>
  )
}
