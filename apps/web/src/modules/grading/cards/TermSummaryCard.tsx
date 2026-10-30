import { CardSkeleton } from '@/app/board/CardSkeleton'
import type { CardProps } from '@/app/extensions'
import { AnimatedNumber } from '@/components/AnimatedNumber'
import { HistoryLink } from '@/components/HistoryLink'
import { formatCredits } from '@/lib/format'
import { termPath } from '@/modules/academics/paths'
import { m } from '@/paraglide/messages'
import { GpaValue } from '../components/GpaValue'
import { percentText } from '../display'
import { useTermGrades } from '../queries'

/** The term's GPA, credits and course count (M03 §5.3). */
export default function TermSummaryCard({ scope, size }: CardProps) {
  const termId = scope.kind === 'term' ? scope.termId : ''
  const { data } = useTermGrades(termId)
  if (!data) return <CardSkeleton />
  return (
    <HistoryLink
      href={termPath(scope.programId, termId, 'grades')}
      className="flex h-full flex-col justify-between gap-2 rounded-xl"
    >
      <div>
        <p className="text-xs text-muted-foreground">{m.grading_term_gpa()}</p>
        <p className="text-3xl font-semibold tabular-nums">
          <GpaValue value={data.gpa} hidden={data.hide_gpa} animated />
        </p>
      </div>
      {size === 'm' ? (
        <dl className="space-y-0.5 text-xs text-muted-foreground">
          <div className="flex justify-between gap-2">
            <dt>{m.grading_credits_counted()}</dt>
            <dd className="text-foreground tabular-nums">
              <AnimatedNumber value={data.credits_counted} format={formatCredits} />
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>{m.grading_average()}</dt>
            <dd className="text-foreground tabular-nums">{percentText(data.average_percentage)}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>{m.grading_courses()}</dt>
            <dd className="text-foreground tabular-nums">{data.courses.length}</dd>
          </div>
        </dl>
      ) : null}
    </HistoryLink>
  )
}
