import type { CardProps } from '@/app/extensions'
import { HistoryLink } from '@/components/HistoryLink'
import { coursePath } from '@/modules/academics/paths'
import { formatDate } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { GpaValue } from '../components/GpaValue'
import { requiredText } from '../components/SummaryStrip'
import { percentText } from '../display'
import { useGradebook } from '../queries'

/** Current or final grade, GPA, the average still needed and the next deadline (M03 §5.3). */
export default function CourseSummaryCard({ scope, size }: CardProps) {
  const courseId = scope.kind === 'course' ? scope.courseId : ''
  const { data } = useGradebook(courseId)
  if (!data) return null
  const { summary: s, scale, result } = data
  const grade = s.final_percentage ?? s.current_percentage
  const letter = s.final_percentage === null ? s.current_letter : s.final_letter
  const points = s.final_percentage === null ? s.current_points : s.final_points
  const next = data.assessments
    .filter((a) => a.status !== 'graded' && !a.dropped && a.due_at !== null)
    .toSorted((a, b) => Date.parse(a.due_at ?? '') - Date.parse(b.due_at ?? ''))[0]
  return (
    <HistoryLink
      href={coursePath(scope.programId, courseId, 'grades')}
      className="flex h-full flex-col justify-between gap-2 rounded-xl"
    >
      <div>
        <p className="text-xs text-muted-foreground">
          {s.final_percentage === null ? m.grading_current() : m.grading_final()}
        </p>
        <p className="text-3xl font-semibold tabular-nums">
          {s.status === 'passed' || s.status === 'failed'
            ? result.pass_fail_result === 'pass'
              ? m.grading_pass()
              : m.grading_fail()
            : s.weights_ok || s.overridden || !result.gradebook_enabled
              ? percentText(grade)
              : '—'}
        </p>
        <p className="text-sm text-muted-foreground">
          {letter ? `${letter} · ` : null}
          {m.grading_gpa()} <GpaValue value={points} hidden={scale.hide_gpa} />
        </p>
      </div>
      {size === 'm' && result.basis === 'percentage' ? (
        <dl className="space-y-0.5 text-xs text-muted-foreground">
          <div className="flex justify-between gap-2">
            <dt>{m.grading_target_needed()}</dt>
            <dd className="font-medium text-foreground">{requiredText(s)}</dd>
          </div>
          {next?.due_at ? (
            <div className="flex justify-between gap-2">
              <dt className="truncate">{next.title}</dt>
              <dd>{formatDate(next.due_at)}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </HistoryLink>
  )
}
