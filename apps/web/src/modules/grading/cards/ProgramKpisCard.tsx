import type { CardProps } from '@/app/extensions'
import { ProgressBar } from '@/components/Progress'
import { formatCredits } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { GpaValue } from '../components/GpaValue'
import { Stat } from '../components/SummaryStrip'
import { percentText } from '../display'
import { useProgramGrades } from '../queries'

/** Cumulative GPA, average, credit progress and term count (M03 §5.3). */
export default function ProgramKpisCard({ scope }: CardProps) {
  const { data } = useProgramGrades(scope.programId)
  if (!data) return null
  const required = data.credits_required
  return (
    <div className="grid h-full content-start gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Stat label={m.grading_cumulative_gpa()}>
        <GpaValue value={data.gpa} hidden={data.hide_gpa} />
      </Stat>
      <Stat label={m.grading_average()}>{percentText(data.average_percentage)}</Stat>
      <Stat
        label={m.grading_credits_earned()}
        hint={required === null ? null : m.grading_credits_of({ total: formatCredits(required) })}
      >
        {formatCredits(data.credits_earned)}
        {data.progress === null ? null : (
          <ProgressBar
            className="mt-2"
            value={data.progress * 100}
            label={m.grading_credits_progress()}
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
