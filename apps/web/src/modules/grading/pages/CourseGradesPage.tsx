import type { Gradebook } from '@semestra/api-client'
import { useId } from 'react'
import type { PageProps } from '@/app/extensions'
import { useUiPref } from '@/app/ui-pref'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { omitKey } from '@/lib/omit'
import { m } from '@/paraglide/messages'
import { Field, FieldLabel } from '@/ui/field'
import { Switch } from '@/ui/switch'
import { AssessmentTable } from '../components/AssessmentTable'
import { ImportMenu } from '../components/ImportMenu'
import { ManualGrade } from '../components/ManualGrade'
import { PlanPanel } from '../components/PlanPanel'
import { SummaryStrip } from '../components/SummaryStrip'
import { useGradebook } from '../queries'
import { DEFAULT_WHATIF, type WhatIf } from '../whatif'

/** The course's grades: summary, plan mode and the assessment table (M03 §5.1). */
export default function CourseGradesPage({ scope }: PageProps) {
  const courseId = scope.kind === 'course' ? scope.courseId : ''
  return (
    <AsyncBoundary query={useGradebook(courseId)}>
      {(gradebook) => (
        <CourseGrades key={courseId} gradebook={gradebook} programId={scope.programId} />
      )}
    </AsyncBoundary>
  )
}

function CourseGrades({ gradebook, programId }: { gradebook: Gradebook; programId: string }) {
  const planId = useId()
  const courseId = gradebook.course_id
  const [whatIf, setWhatIf] = useUiPref<WhatIf>('grading.whatif', DEFAULT_WHATIF, {
    scope: courseId,
  })
  const { result, summary } = gradebook

  if (result.basis === 'pass_fail' || !result.gradebook_enabled) {
    return <ManualGrade gradebook={gradebook} />
  }

  const canPlan = summary.weights_ok
  const planning = whatIf.plan && canPlan
  const state = { ...whatIf, plan: planning }
  const assume = (assessmentId: string, percent: number | null) => {
    const rest = omitKey(whatIf.scores, assessmentId)
    setWhatIf({ ...whatIf, scores: percent === null ? rest : { ...rest, [assessmentId]: percent } })
  }

  return (
    <div className="space-y-4">
      <SummaryStrip gradebook={gradebook} />
      <Field orientation="horizontal" className="w-fit">
        <Switch
          id={planId}
          checked={planning}
          disabled={!canPlan}
          onCheckedChange={(plan) => setWhatIf({ ...whatIf, plan })}
        />
        <FieldLabel htmlFor={planId} className="font-normal">
          {m.grading_plan()}
        </FieldLabel>
        {canPlan ? null : (
          <span className="text-xs text-muted-foreground">{m.grading_plan_needs_weights()}</span>
        )}
      </Field>
      {planning ? <PlanPanel gradebook={gradebook} whatIf={state} onChange={setWhatIf} /> : null}
      <AssessmentTable
        courseId={courseId}
        assessments={gradebook.assessments}
        categories={gradebook.categories}
        whatIf={state}
        onAssume={assume}
        actions={<ImportMenu programId={programId} courseId={courseId} />}
      />
    </div>
  )
}
