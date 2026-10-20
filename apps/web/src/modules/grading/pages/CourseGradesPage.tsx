import type { Gradebook } from '@semestra/api-client'
import { useQueryClient } from '@tanstack/react-query'
import { TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import type { PageProps } from '@/app/extensions'
import { useExtensions } from '@/app/registry'
import { updateUiPref, useUiPref } from '@/app/ui-pref'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { formatCredits } from '@/lib/format'
import { omitKey } from '@/lib/omit'
import { m } from '@/paraglide/messages'
import { Alert, AlertDescription } from '@/ui/alert'
import { AssessmentDialog } from '../components/AssessmentDialog'
import { AssessmentTable } from '../components/AssessmentTable'
import { GradebookToolbar } from '../components/GradebookToolbar'
import { GradeComposition } from '../components/GradeComposition'
import { ManualGrade } from '../components/ManualGrade'
import { TargetCard } from '../components/TargetCard'
import { useGradebook } from '../queries'
import { COURSE_GRADES_BANNERS, type CourseGradesBanner } from '../types'
import { usePlanSimulation } from '../use-plan'
import { DEFAULT_WHATIF, type WhatIf, activeScores } from '../whatif'

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
  const courseId = gradebook.course_id
  const [whatIf, setWhatIf] = useUiPref<WhatIf>('grading.whatif', DEFAULT_WHATIF, {
    scope: courseId,
  })
  const [grouped, setGrouped] = useUiPref('grading.group', false)
  const [adding, setAdding] = useState(false)
  const queryClient = useQueryClient()
  const banners = useExtensions<CourseGradesBanner>(COURSE_GRADES_BANNERS)
  const { result, summary } = gradebook
  const canPlan = summary.weights_ok
  const planning = whatIf.plan && canPlan
  const state = { ...whatIf, plan: planning }
  const planned = usePlanSimulation(gradebook, state)

  const notices = banners.map((banner) => (
    <banner.component key={banner.id} programId={programId} courseId={courseId} />
  ))

  if (result.basis === 'pass_fail' || !result.gradebook_enabled) {
    return (
      <div className="space-y-4">
        {notices}
        <ManualGrade gradebook={gradebook} />
      </div>
    )
  }

  const assumed = activeScores(gradebook.assessments, whatIf.scores)
  const assume = (assessmentId: string, percent: number | null) => {
    const rest = omitKey(whatIf.scores, assessmentId)
    setWhatIf({ ...whatIf, scores: percent === null ? rest : { ...rest, [assessmentId]: percent } })
  }
  const clearAssumptions = () => {
    const before = whatIf.scores
    setWhatIf({ ...whatIf, scores: {} })
    // Undo brings back only the scores, on top of whatever changed since (target, plan mode,
    // assumptions typed after clearing).
    const undo = () =>
      void updateUiPref<WhatIf>(queryClient, `grading.whatif.${courseId}`, (current) => ({
        ...DEFAULT_WHATIF,
        ...current,
        scores: { ...before, ...current?.scores },
      }))
    toast(m.grading_plan_cleared(), { action: { label: m.common_undo(), onClick: undo } })
  }

  return (
    <div className="space-y-4">
      {notices}
      {summary.weights_ok ? null : (
        <Alert>
          <TriangleAlert aria-hidden />
          <AlertDescription>
            {m.grading_weights_warning({
              total: formatCredits(summary.weight_total),
              gap: formatCredits(Math.abs(summary.weight_gap)),
            })}
          </AlertDescription>
        </Alert>
      )}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <AssessmentTable
          courseId={courseId}
          assessments={gradebook.assessments}
          categories={gradebook.categories}
          whatIf={state}
          onAssume={assume}
          grouped={grouped}
          toolbar={
            <GradebookToolbar
              programId={programId}
              result={result}
              count={gradebook.assessments.length}
              planning={planning}
              canPlan={canPlan}
              hasAssumptions={Object.keys(assumed).length > 0}
              onPlanningChange={(plan) => setWhatIf({ ...whatIf, plan })}
              onClearAssumptions={clearAssumptions}
              grouped={grouped}
              onGroupedChange={setGrouped}
              onAdd={() => setAdding(true)}
            />
          }
        />
        {/* On narrow screens the summary comes first. */}
        <aside className="-order-1 grid gap-4 sm:grid-cols-2 lg:sticky lg:top-4 lg:order-none lg:grid-cols-1">
          <GradeComposition
            gradebook={gradebook}
            planned={planned}
            planning={planning}
            assumed={planning ? assumed : {}}
          />
          <TargetCard
            gradebook={gradebook}
            planning={planning}
            planned={planned}
            whatIf={state}
            onChange={setWhatIf}
          />
        </aside>
      </div>
      <AssessmentDialog
        courseId={courseId}
        categories={gradebook.categories}
        open={adding}
        onOpenChange={setAdding}
      />
    </div>
  )
}
