import type { Gradebook } from '@semestra/api-client'
import type { ReactNode } from 'react'
import { m } from '@/paraglide/messages'
import { GpaValue, PercentValue } from '../components/GradeValue'
import { headline } from '../display'

/**
 * A course's grade as the phone shows it (M17 §9), the same one the desktop's grades page shows:
 * the pass/fail result for a pass/fail course, the grade entered by hand when the gradebook is
 * off, else the gradebook's grade so far (or final). `gradebook` is false when there is no
 * gradebook to list under it.
 */
export function phoneGrade(data: Gradebook): {
  label: string
  value: ReactNode
  gpa: ReactNode | null
  gradebook: boolean
} {
  const { summary: s, result } = data
  if (result.basis === 'pass_fail') {
    return {
      label: m.grading_final_grade(),
      value:
        result.pass_fail_result === 'pass'
          ? m.grading_pass()
          : result.pass_fail_result === 'fail'
            ? m.grading_fail()
            : m.grading_pass_fail_pending(),
      gpa: null,
      gradebook: false,
    }
  }
  if (!result.gradebook_enabled) {
    return {
      label: m.grading_final_grade(),
      value: s.final_percentage === null ? '—' : <PercentValue value={s.final_percentage} />,
      gpa: <GpaValue value={s.final_points} letter={s.final_letter} letterClassName="ml-1.5" />,
      gradebook: false,
    }
  }
  const { final, percentage, letter, points } = headline(s)
  return {
    label: final ? m.grading_final_grade() : m.grading_current_grade(),
    value: s.weights_ok || s.overridden ? <PercentValue value={percentage} /> : '—',
    gpa: <GpaValue value={points} letter={letter} letterClassName="ml-1.5" />,
    gradebook: true,
  }
}
