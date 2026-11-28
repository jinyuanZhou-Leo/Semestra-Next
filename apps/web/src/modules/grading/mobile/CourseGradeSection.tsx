import { Link } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { MobileList, MobileSection } from '@/app/mobile/MobilePage'
import { m } from '@/paraglide/messages'
import { GpaValue, HideGrades, PercentValue } from '../components/GradeValue'
import { headline } from '../display'
import { useGradebook } from '../queries'

/** The course's grade on its phone overview (M17 §4.1); opens the grades segment. */
export default function CourseGradeSection({
  programId,
  courseId,
}: {
  programId: string
  courseId: string
}) {
  const data = useGradebook(courseId).data
  if (!data || !data.result.gradebook_enabled) return null
  const { summary: s, scale, result } = data
  const { final, percentage, letter, points } = headline(s)
  const value =
    s.status === 'passed' || s.status === 'failed'
      ? result.pass_fail_result === 'pass'
        ? m.grading_pass()
        : m.grading_fail()
      : null
  return (
    <MobileSection title={final ? m.grading_final_grade() : m.grading_current_grade()}>
      <HideGrades hidden={scale.hide_grades}>
        <MobileList>
          <li>
            <Link
              to="/p/$programId/c/$courseId/$page"
              params={{ programId, courseId, page: 'grades' }}
              replace
              className="flex items-center gap-3 px-4 py-3"
            >
              <span className="flex-1 font-heading text-2xl font-semibold tabular-nums">
                {value ??
                  (s.weights_ok || s.overridden ? <PercentValue value={percentage} /> : '—')}
              </span>
              {value === null ? (
                <span className="text-sm text-muted-foreground tabular-nums">
                  <GpaValue value={points} letter={letter} letterClassName="ml-1.5" />
                </span>
              ) : null}
              <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
            </Link>
          </li>
        </MobileList>
      </HideGrades>
    </MobileSection>
  )
}
