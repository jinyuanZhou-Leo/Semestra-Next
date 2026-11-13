import { CardSkeleton } from '@/app/board/CardSkeleton'
import type { CardProps } from '@/app/extensions'
import { AnimatedNumber } from '@/components/AnimatedNumber'
import { HistoryLink } from '@/components/HistoryLink'
import { formatCredits, formatGpa } from '@/lib/format'
import { termPath } from '@/modules/academics/paths'
import { m } from '@/paraglide/messages'
import { Progress } from '@/ui/progress'
import { Concealed, GpaValue, HideGrades, PercentValue } from '../components/GradeValue'
import { useProgramGrades } from '../queries'

/**
 * The Program's standing (M03 §5.3): the cumulative GPA as the headline with average, credits
 * and their progress beside it, and each term's GPA as a bar against the scale's maximum, newest
 * first. Side by side when the card is wide, stacked when it is not (container query).
 */
export default function ProgramKpisCard({ scope }: CardProps) {
  const { data } = useProgramGrades(scope.programId)
  if (!data) return <CardSkeleton />
  const required = data.credits_required
  const terms = data.terms.toReversed()
  return (
    <HideGrades hidden={data.hide_grades}>
      <div className="@container flex h-full min-h-0 flex-col">
        <div className="grid min-h-0 flex-1 gap-x-8 gap-y-4 @xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="flex min-w-0 flex-col gap-3">
            <div>
              <p className="text-xs text-muted-foreground">{m.grading_cumulative_gpa()}</p>
              <p className="font-heading text-5xl leading-tight font-semibold tabular-nums">
                <GpaValue value={data.gpa} animated />
              </p>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <dt className="text-xs text-muted-foreground">{m.grading_average()}</dt>
              <dt className="text-xs text-muted-foreground">{m.grading_credits_earned()}</dt>
              <dd className="font-medium tabular-nums">
                <PercentValue value={data.average_percentage} animated />
              </dd>
              <dd className="font-medium tabular-nums">
                <AnimatedNumber value={data.credits_earned} format={formatCredits} />
                {required === null ? null : (
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    {m.grading_credits_of({ total: formatCredits(required) })}
                  </span>
                )}
              </dd>
            </dl>
            {data.progress === null ? null : (
              <Progress
                className="[&_[data-slot=progress-track]]:h-1.5"
                value={data.progress * 100}
                aria-label={m.grading_credits_progress()}
              />
            )}
            <p className="mt-auto text-xs text-muted-foreground">
              {m.grading_graded_courses({ count: data.graded_course_count })}
            </p>
          </div>
          <section className="flex min-h-0 min-w-0 flex-col gap-1.5">
            <h4 className="text-xs text-muted-foreground">{m.grading_kpis_by_term()}</h4>
            <ol className="min-h-0 flex-1 scroll-fade space-y-0.5 overflow-y-auto">
              {terms.map((term) => (
                <li key={term.term_id}>
                  <HistoryLink
                    href={termPath(scope.programId, term.term_id, 'grades')}
                    className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_3rem] items-center gap-3 rounded-lg px-2 py-1 text-sm transition-colors hover:bg-muted/50"
                  >
                    <span className="truncate">{term.name}</span>
                    <Progress
                      aria-hidden
                      value={term.gpa === null || data.hide_grades ? 0 : term.gpa}
                      max={data.max_points}
                      className="[&_[data-slot=progress-track]]:h-1.5"
                    />
                    <span className="text-right font-medium tabular-nums">
                      {term.gpa === null ? (
                        <span className="text-xs font-normal text-muted-foreground">—</span>
                      ) : (
                        <Concealed>{formatGpa(term.gpa)}</Concealed>
                      )}
                    </span>
                  </HistoryLink>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </HideGrades>
  )
}
