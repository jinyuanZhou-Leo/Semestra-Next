import type { CardProps } from '@/app/extensions'
import { AnimatedNumber } from '@/components/AnimatedNumber'
import { formatCredits } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { Progress } from '@/ui/progress'
import { GpaValue } from '../components/GpaValue'
import { Stat } from '../components/Stat'
import { AnimatedPercent } from '../components/AnimatedPercent'
import { useProgramGrades } from '../queries'

/** Cumulative GPA, average, credit progress and term count (M03 §5.3). */
export default function ProgramKpisCard({ scope }: CardProps) {
  const { data } = useProgramGrades(scope.programId)
  if (!data) return null
  const required = data.credits_required
  return (
    <div className="grid h-full content-start gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Stat label={m.grading_cumulative_gpa()}>
        <GpaValue value={data.gpa} hidden={data.hide_gpa} animated />
      </Stat>
      <Stat label={m.grading_average()}>
        <AnimatedPercent value={data.average_percentage} />
      </Stat>
      <Stat
        label={m.grading_credits_earned()}
        hint={required === null ? null : m.grading_credits_of({ total: formatCredits(required) })}
      >
        <AnimatedNumber value={data.credits_earned} format={formatCredits} />
        {data.progress === null ? null : (
          <Progress
            className="mt-2 [&_[data-slot=progress-track]]:h-1"
            value={data.progress * 100}
            aria-label={m.grading_credits_progress()}
          />
        )}
      </Stat>
      <Stat
        label={m.grading_terms()}
        hint={m.grading_graded_courses({ count: data.graded_course_count })}
      >
        {data.term_count}
      </Stat>
    </div>
  )
}
