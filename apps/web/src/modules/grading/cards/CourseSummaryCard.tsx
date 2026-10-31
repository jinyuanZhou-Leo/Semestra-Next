import { CardSkeleton } from '@/app/board/CardSkeleton'
import { CardStat } from '@/app/board/CardStat'
import type { CardProps } from '@/app/extensions'
import { HistoryLink } from '@/components/HistoryLink'
import { coursePath } from '@/modules/academics/paths'
import { m } from '@/paraglide/messages'
import { GpaValue } from '../components/GpaValue'
import { requiredText } from '../components/Stat'
import { AnimatedPercent } from '../components/AnimatedPercent'
import { dueText, headline } from '../display'
import { useGradebook } from '../queries'

/** Current or final grade, GPA, the average still needed and the next deadline (M03 §5.3). */
export default function CourseSummaryCard({ scope, size }: CardProps) {
  const courseId = scope.kind === 'course' ? scope.courseId : ''
  const { data } = useGradebook(courseId)
  if (!data) return <CardSkeleton />
  const { summary: s, scale, result } = data
  const { final, percentage: grade, letter, points } = headline(s)
  const next = data.assessments
    .filter((a) => a.status !== 'graded' && !a.dropped && a.due_at !== null)
    .toSorted((a, b) => Date.parse(a.due_at ?? '') - Date.parse(b.due_at ?? ''))[0]
  const value =
    s.status === 'passed' || s.status === 'failed' ? (
      result.pass_fail_result === 'pass' ? (
        m.grading_pass()
      ) : (
        m.grading_fail()
      )
    ) : s.weights_ok || s.overridden || !result.gradebook_enabled ? (
      <AnimatedPercent value={grade} />
    ) : (
      '—'
    )
  return (
    <HistoryLink
      href={coursePath(scope.programId, courseId, 'grades')}
      className="-mx-2 -my-1 flex h-full rounded-xl px-2 py-1 transition-colors hover:bg-muted/50"
    >
      <CardStat
        className="flex-1"
        label={
          size === 's'
            ? final
              ? m.grading_final_grade()
              : m.grading_current_grade()
            : final
              ? m.grading_final()
              : m.grading_current()
        }
        value={value}
        footer={
          <>
            <p>
              {m.grading_gpa()}{' '}
              <GpaValue
                value={points}
                hidden={scale.hide_gpa}
                letter={letter}
                letterClassName="ml-1.5"
                className="text-foreground"
                animated
              />
            </p>
            {size === 'm' && result.basis === 'percentage' ? (
              <dl className="grid grid-cols-[1fr_auto] gap-x-2 gap-y-0.5">
                <dt>{m.grading_target_needed()}</dt>
                <dd className="font-medium text-foreground">{requiredText(s)}</dd>
                {next?.due_at ? (
                  <>
                    <dt className="truncate">{next.title}</dt>
                    <dd>{dueText(next)}</dd>
                  </>
                ) : null}
              </dl>
            ) : null}
          </>
        }
      />
    </HistoryLink>
  )
}
