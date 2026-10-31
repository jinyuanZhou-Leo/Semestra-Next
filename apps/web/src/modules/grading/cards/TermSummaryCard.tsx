import { CardSkeleton } from '@/app/board/CardSkeleton'
import { CardStat } from '@/app/board/CardStat'
import type { CardProps } from '@/app/extensions'
import { AnimatedNumber } from '@/components/AnimatedNumber'
import { HistoryLink } from '@/components/HistoryLink'
import { formatCredits } from '@/lib/format'
import { termPath } from '@/modules/academics/paths'
import { m } from '@/paraglide/messages'
import { GpaValue } from '../components/GpaValue'
import { percentText } from '../display'
import { useTermGrades } from '../queries'

/** The term's GPA, with its average and credits below (M03 §5.3). Opens the term's grades. */
export default function TermSummaryCard({ scope, size }: CardProps) {
  const termId = scope.kind === 'term' ? scope.termId : ''
  const { data } = useTermGrades(termId)
  if (!data) return <CardSkeleton />
  return (
    <HistoryLink
      href={termPath(scope.programId, termId, 'grades')}
      className="-mx-2 -my-1 flex h-full rounded-xl px-2 py-1 transition-colors hover:bg-muted/50"
    >
      <CardStat
        className="flex-1"
        label={size === 's' ? m.grading_term_gpa() : undefined}
        value={<GpaValue value={data.gpa} hidden={data.hide_gpa} animated />}
        footer={
          <dl className="grid grid-cols-[1fr_auto] gap-x-2 gap-y-0.5">
            <dt>{m.grading_average()}</dt>
            <dd className="text-foreground tabular-nums">{percentText(data.average_percentage)}</dd>
            <dt>{m.grading_credits_counted()}</dt>
            <dd className="text-foreground tabular-nums">
              <AnimatedNumber value={data.credits_counted} format={formatCredits} />
            </dd>
            {size === 'm' ? (
              <>
                <dt>{m.grading_courses()}</dt>
                <dd className="text-foreground tabular-nums">{data.courses.length}</dd>
              </>
            ) : null}
          </dl>
        }
      />
    </HistoryLink>
  )
}
