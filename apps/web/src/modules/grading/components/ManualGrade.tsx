import type { Gradebook } from '@semestra/api-client'
import { gradingCourseResultUpdateMutation } from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { ChoiceControl } from '@/app/settings/choice'
import { percentText } from '../display'
import { invalidateGrading } from '../queries'
import { GpaValue } from './GpaValue'
import { InlineInput } from './InlineInput'
import { Stat } from './Stat'

/**
 * The course has no gradebook (M03 §2): a Pass/Fail course takes a result, any other course just
 * its final percentage.
 */
export function ManualGrade({ gradebook }: { gradebook: Gradebook }) {
  const queryClient = useQueryClient()
  const { result, summary: s, scale } = gradebook
  const update = useMutation({
    ...gradingCourseResultUpdateMutation(),
    onError: toastError,
    onSuccess: () => invalidateGrading(queryClient),
  })
  const patch = (body: Parameters<typeof update.mutate>[0]['body']) =>
    update.mutate({ path: { course_id: gradebook.course_id }, body })

  if (result.basis === 'pass_fail') {
    return (
      <Stat label={m.grading_pass_fail_result()}>
        <ChoiceControl<'pending' | 'pass' | 'fail'>
          label={m.grading_pass_fail_result()}
          value={result.pass_fail_result ?? 'pending'}
          onChange={(next) => patch({ pass_fail_result: next === 'pending' ? null : next })}
          options={[
            { value: 'pending', label: m.grading_pass_fail_pending() },
            { value: 'pass', label: m.grading_pass() },
            { value: 'fail', label: m.grading_fail() },
          ]}
        />
      </Stat>
    )
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Stat label={m.grading_final_grade()} hint={s.final_letter}>
        <InlineInput
          key={`m-${result.manual_percentage ?? ''}`}
          label={m.grading_final_grade()}
          placeholder="—"
          value={result.manual_percentage === null ? '' : String(result.manual_percentage)}
          onCommit={(text) => {
            if (text.trim() === '') {
              patch({ manual_percentage: null })
              return true
            }
            const value = Number(text.replace('%', '').replace(',', '.'))
            if (!(value >= 0 && value <= 1000)) return false
            patch({ manual_percentage: value })
            return true
          }}
          className="-ml-3 h-9 w-28 border-input text-left text-2xl font-semibold md:text-2xl"
        />
      </Stat>
      <Stat label={m.grading_gpa()} hint={percentText(s.final_percentage)}>
        <GpaValue value={s.final_points} hidden={scale.hide_gpa} />
      </Stat>
    </div>
  )
}
