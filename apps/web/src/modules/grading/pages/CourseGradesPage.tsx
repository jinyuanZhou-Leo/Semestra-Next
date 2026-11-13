import type { Gradebook } from '@semestra/api-client'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import type { PageProps } from '@/app/extensions'
import { updateUiPref, useUiPref } from '@/app/ui-pref'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { useDialogTarget } from '@/lib/dialog-target'
import { omitKey } from '@/lib/omit'
import { m } from '@/paraglide/messages'
import { AssessmentDialog } from '../components/AssessmentDialog'
import { AssessmentTable } from '../components/AssessmentTable'
import type { AssessmentSelection } from '../components/assessment-columns'
import { type BatchTarget, BatchDialogs } from '../components/BatchDialogs'
import { GradebookToolbar } from '../components/GradebookToolbar'
import { useHighlightedAssessment } from '../components/use-highlight'
import { ForecastCard } from '../components/ForecastCard'
import { GradeComposition } from '../components/GradeComposition'
import { ManualGrade } from '../components/ManualGrade'
import { CourseTarget } from '../components/CourseTarget'
import { type AssessmentFilter, matchesFilter } from '../filter'
import { useGradebook } from '../queries'
import { groupByCategory, isFolded } from '../sort'
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
  const [filter, setFilter] = useState<AssessmentFilter>('all')
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set())
  const highlighted = useHighlightedAssessment()
  const batch = useDialogTarget<BatchTarget>()
  const queryClient = useQueryClient()
  const { result, summary } = gradebook
  const canPlan = summary.weights_ok
  const planning = whatIf.plan && canPlan
  const state = { scores: whatIf.scores, plan: planning }
  const planned = usePlanSimulation(gradebook, state)

  if (result.basis === 'pass_fail' || !result.gradebook_enabled) {
    return <ManualGrade gradebook={gradebook} />
  }

  // Only rows on screen are checked: a filter or a collapsed group hides a row from the batch,
  // plan mode all of them.
  const matching = gradebook.assessments.filter((a) => matchesFilter(a, filter, search))
  const shown = planning
    ? []
    : grouped
      ? groupByCategory(matching, gradebook.categories, (a) => a.category_id)
          .filter(
            (g) =>
              !isFolded(
                g.category,
                g.items.map((a) => a.id),
                collapsed,
                highlighted,
              ),
          )
          .flatMap((g) => g.items)
      : matching
  const selected = shown.filter((a) => checked.has(a.id))
  const clearSelection = () => setChecked(new Set())
  const selection: AssessmentSelection = {
    has: (id) => checked.has(id),
    state: (ids) => {
      const count = ids.filter((id) => checked.has(id)).length
      return count === 0 ? false : count === ids.length ? true : 'some'
    },
    toggle: (ids) =>
      setChecked((prev) => {
        const next = new Set(prev)
        const all = ids.every((id) => prev.has(id))
        for (const id of ids) {
          if (all) next.delete(id)
          else next.add(id)
        }
        return next
      }),
    shown: shown.map((a) => a.id),
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
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <AssessmentTable
          programId={programId}
          courseId={courseId}
          assessments={gradebook.assessments}
          categories={gradebook.categories}
          figures={gradebook.summary.categories}
          hideGrades={gradebook.scale.hide_grades}
          whatIf={state}
          predictions={(planning ? planned : null)?.predictions ?? gradebook.summary.predictions}
          onAssume={assume}
          grouped={grouped}
          collapsed={collapsed}
          onToggleGroup={(key) =>
            setCollapsed((prev) => {
              const next = new Set(prev)
              if (!next.delete(key)) next.add(key)
              return next
            })
          }
          highlighted={highlighted}
          filter={filter}
          search={search}
          onClearFilter={() => {
            setFilter('all')
            setSearch('')
          }}
          selection={selection}
          toolbar={
            <GradebookToolbar
              programId={programId}
              result={result}
              filter={filter}
              onFilterChange={setFilter}
              search={search}
              onSearchChange={setSearch}
              planning={planning}
              canPlan={canPlan}
              hasAssumptions={Object.keys(assumed).length > 0}
              onPlanningChange={(plan) => {
                clearSelection()
                setWhatIf({ ...whatIf, plan })
              }}
              onClearAssumptions={clearAssumptions}
              grouped={grouped}
              onGroupedChange={setGrouped}
              onAdd={() => setAdding(true)}
              categories={gradebook.categories}
              selected={selected}
              onBatchWeight={() => batch.show({ kind: 'weight', assessments: selected })}
              onBatchDelete={() => batch.show({ kind: 'delete', assessments: selected })}
              onClearSelection={clearSelection}
            />
          }
        />
        {/* On narrow screens the summary comes first. */}
        <aside className="-order-1 grid gap-4 sm:grid-cols-2 lg:sticky lg:top-4 lg:order-none lg:grid-cols-1">
          <GradeComposition gradebook={gradebook} />
          <ForecastCard
            gradebook={gradebook}
            planning={planning}
            planned={planned}
            whatIf={state}
            footer={
              <CourseTarget
                gradebook={gradebook}
                planning={planning}
                planned={planned}
                whatIf={state}
                onChange={setWhatIf}
              />
            }
          />
        </aside>
      </div>
      <AssessmentDialog
        courseId={courseId}
        categories={gradebook.categories}
        open={adding}
        onOpenChange={setAdding}
      />
      <BatchDialogs
        {...batch.props}
        courseId={courseId}
        target={batch.target}
        close={batch.close}
        onDeleted={clearSelection}
      />
    </div>
  )
}
