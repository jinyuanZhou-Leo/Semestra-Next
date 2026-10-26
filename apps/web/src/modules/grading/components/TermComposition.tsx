import type { CourseGrade, TermGradeSimulation, TermGrades } from '@semestra/api-client'
import { useState } from 'react'
import { formatCredits, formatGpa } from '@/lib/format'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { GPA_MASK, percentText } from '../display'
import { AnimatedPercent } from './AnimatedPercent'
import { CompositionRing, type RingSlice } from './CompositionRing'
import { GpaValue } from './GpaValue'

type Slice = RingSlice & { name: string; course: CourseGrade; assumedPercentage: number | null }

/** A course that can take a share of the term GPA: graded by percentage, with credits here. */
const countsTowardGpa = (c: CourseGrade) =>
  c.include_in_gpa && c.basis === 'percentage' && (c.attributed_credits ?? 0) > 0

const FALLBACK_COLOR = 'var(--muted-foreground)'

const STATUS_LABEL = {
  completed: () => m.grading_status_completed(),
  in_progress: () => m.grading_status_in_progress(),
  passed: () => m.grading_status_passed(),
  failed: () => m.grading_status_failed(),
} as const

export const courseStatusLabel = (status: CourseGrade['status']) => STATUS_LABEL[status]()

function SliceDetails({ slice, hideGpa }: { slice: Slice; hideGpa: boolean }) {
  const c = slice.course
  const rows: [string, string][] = [
    [m.grading_credits(), formatCredits(slice.weight)],
    [m.grading_status(), courseStatusLabel(c.status)],
    [m.grading_percentage(), percentText(c.percentage ?? c.current_percentage)],
  ]
  if (slice.assumedPercentage !== null)
    rows.push([m.grading_assumed_score(), percentText(slice.assumedPercentage)])
  rows.push([m.grading_gpa(), c.points === null ? '—' : hideGpa ? GPA_MASK : formatGpa(c.points)])
  return (
    <div className="grid min-w-40 gap-1.5">
      <div className="flex items-center gap-1.5 font-medium">
        <span
          aria-hidden
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: slice.color }}
        />
        {slice.name}
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
 * How the term GPA is made up (M03 §5.2), in the same card as a course's grade breakdown: a ring
 * with each course's credits, solid once the course counts, the average in its middle and the
 * GPA beside it. In plan mode the same card shows the simulated result.
 */
export function TermComposition({
  term,
  planned,
  planning,
  scores,
  colors,
  label,
}: {
  term: TermGrades
  /** The simulated term while planning (null until it arrives). */
  planned: TermGradeSimulation | null
  planning: boolean
  /** Assumed final percentage per unfinished course id. */
  scores: Readonly<Record<string, number>>
  /** Display color per course id. */
  colors: ReadonlyMap<string, string>
  /** How a course is named. */
  label: (c: CourseGrade) => string
}) {
  const [hovered, setHovered] = useState<string | null>(null)
  const data: Slice[] = term.courses.filter(countsTowardGpa).map((c) => {
    const weight = c.attributed_credits ?? 0
    const assumedPercentage = planning ? (scores[c.course_id] ?? null) : null
    const assumed = assumedPercentage !== null
    return {
      key: c.course_id,
      name: label(c),
      color: colors.get(c.course_id) ?? FALLBACK_COLOR,
      weight,
      graded: c.counts_in_gpa && !assumed ? weight : 0,
      assumed: assumed ? weight : 0,
      course: c,
      assumedPercentage,
    }
  })
  const counted = planning ? (planned?.credits_counted ?? null) : term.credits_counted

  return (
    <section aria-label={m.grading_composition()} className="rounded-2xl border border-border p-4">
      <div className="flex items-center gap-4">
        <CompositionRing
          data={data}
          planning={planning}
          hovered={hovered}
          onHoveredChange={setHovered}
          renderDetails={(slice) => <SliceDetails slice={slice} hideGpa={term.hide_gpa} />}
        >
          <span className={cn('text-xl font-semibold tabular-nums', planning && 'text-primary')}>
            {planning ? (
              percentText(planned?.average_percentage)
            ) : (
              <AnimatedPercent value={term.average_percentage} />
            )}
          </span>
          <span className="text-xs text-muted-foreground">
            {planning
              ? m.grading_actual({ value: percentText(term.average_percentage) })
              : m.grading_average()}
          </span>
        </CompositionRing>
        <dl className="grid min-w-0 gap-3">
          <div>
            <dt className="text-xs text-muted-foreground">
              {planning ? m.grading_planned_gpa() : m.grading_term_gpa()}
            </dt>
            <dd className="text-2xl font-semibold tabular-nums">
              <GpaValue
                value={planning ? (planned?.gpa ?? null) : term.gpa}
                hidden={term.hide_gpa}
                animated={!planning}
              />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{m.grading_credits_counted()}</dt>
            <dd className="text-base font-semibold tabular-nums">
              {counted === null ? '—' : formatCredits(counted)}{' '}
              <span className="text-xs font-normal text-muted-foreground">
                {m.grading_credits_of({ total: formatCredits(term.credits_total) })}
              </span>
            </dd>
          </div>
        </dl>
      </div>
      <div className="mt-3 grid gap-1 border-t border-border pt-3 text-xs">
        <dl className="flex justify-between gap-4">
          <dt className="text-muted-foreground">{m.grading_excluded()}</dt>
          <dd className="font-medium tabular-nums">{term.excluded_count}</dd>
        </dl>
        {/* While planning the unfinished courses count with their assumptions. */}
        {!planning && term.in_progress_count > 0 ? (
          <p className="text-muted-foreground">
            {m.grading_excluded_in_progress({ count: term.in_progress_count })}
          </p>
        ) : null}
      </div>
    </section>
  )
}
