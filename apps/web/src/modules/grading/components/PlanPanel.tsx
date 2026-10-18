import type { Gradebook, GradeTarget } from '@semestra/api-client'
import {
  gradingSimulateCourseMutation,
  gradingSuggestScoresMutation,
} from '@semestra/api-client/react-query'
import { useMutation } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { useEffect } from 'react'
import { SegmentedControl } from '@/components/SegmentedControl'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { percentText } from '../display'
import { type WhatIf, activeScores } from '../whatif'
import { InlineInput } from './InlineInput'
import { GpaValue } from './GpaValue'
import { Stat, requiredText } from './SummaryStrip'

const SIMULATE_DELAY_MS = 200

/**
 * Plan mode (M03 §5.1): the assumed scores are simulated on the server (nothing is saved), so
 * the result and the target check always come from the same engine as real grades.
 */
export function PlanPanel({
  gradebook,
  whatIf,
  onChange,
}: {
  gradebook: Gradebook
  whatIf: WhatIf
  onChange: (next: WhatIf) => void
}) {
  const { course_id: courseId, summary, scale } = gradebook
  const scores = activeScores(gradebook.assessments, whatIf.scores)
  const target = whatIf.target
  const simulate = useMutation({ ...gradingSimulateCourseMutation(), onError: toastError })
  const suggest = useMutation({ ...gradingSuggestScoresMutation(), onError: toastError })
  const run = simulate.mutate
  // Refresh after the user stopped typing, and whenever the real gradebook changed under it.
  const fingerprint = JSON.stringify([scores, target])
  const version = gradebook.assessments.map((a) => a.updated_at).join('|')
  useEffect(() => {
    const timer = setTimeout(
      () => run({ path: { course_id: courseId }, body: { scores, target } }),
      SIMULATE_DELAY_MS,
    )
    return () => clearTimeout(timer)
    // `fingerprint` stands for `scores` and `target`, which change identity on every render.
    // oxlint-disable-next-line react/exhaustive-deps
  }, [courseId, run, fingerprint, version])

  const planned = simulate.data
  const kind = target?.kind ?? 'points'
  const shown = target?.value ?? summary.target_points
  const setTarget = (next: GradeTarget | null) => onChange({ ...whatIf, target: next })

  const autoFill = () =>
    suggest.mutate(
      { path: { course_id: courseId }, body: { target } },
      {
        onSuccess: (result) =>
          onChange({
            ...whatIf,
            scores: Object.fromEntries(result.items.map((i) => [i.assessment_id, i.score])),
          }),
      },
    )

  return (
    <section
      aria-label={m.grading_plan()}
      className="space-y-3 rounded-2xl border border-primary/30 bg-primary/5 p-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="font-heading text-sm font-medium">{m.grading_plan()}</h3>
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">{m.grading_plan_hint()}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-muted-foreground">{m.grading_target()}</span>
        <InlineInput
          key={`pt-${kind}-${shown}`}
          label={m.grading_target()}
          value={String(shown)}
          onCommit={(text) => {
            const value = Number(text.replace(',', '.'))
            const max = kind === 'points' ? scale.max_points : 1000
            if (text.trim() === '' || !(value >= 0 && value <= max)) return false
            setTarget({ kind, value })
            return true
          }}
          className="w-20 border-input"
        />
        <SegmentedControl
          aria-label={m.grading_target_kind()}
          value={kind}
          onValueChange={(next) => {
            if (next === kind) return
            // Switching the unit starts from the equivalent of the course's own goal.
            const value =
              next === 'points' ? summary.target_points : (summary.target_percentage ?? 90)
            setTarget({ kind: next, value })
          }}
          options={[
            { value: 'points', label: m.grading_target_points() },
            { value: 'percentage', label: m.grading_target_percentage() },
          ]}
        />
        <Button variant="outline" size="sm" disabled={suggest.isPending} onClick={autoFill}>
          <Sparkles aria-hidden />
          {m.grading_autofill()}
        </Button>
        {Object.keys(scores).length > 0 ? (
          <Button variant="ghost" size="sm" onClick={() => onChange({ ...whatIf, scores: {} })}>
            {m.grading_plan_clear()}
          </Button>
        ) : null}
      </div>
      {suggest.data && !suggest.data.reachable ? (
        <output className="block text-xs text-destructive">
          {m.grading_autofill_unreachable({
            best: percentText(suggest.data.resulting_percentage),
          })}
        </output>
      ) : null}
      {planned ? (
        <div className="grid gap-3 sm:grid-cols-3" data-testid="plan-result">
          <Stat
            label={m.grading_planned()}
            hint={
              <span className="inline-flex flex-wrap items-center gap-x-2">
                {planned.final_letter ?? planned.forecast_letter ?? planned.current_letter}
                <span>
                  {m.grading_gpa()}{' '}
                  <GpaValue
                    value={
                      planned.final_points ?? planned.forecast_points ?? planned.current_points
                    }
                    hidden={scale.hide_gpa}
                  />
                </span>
              </span>
            }
          >
            {percentText(
              planned.final_percentage ?? planned.forecast_percentage ?? planned.current_percentage,
            )}
          </Stat>
          <Stat label={m.grading_target_needed()}>{requiredText(planned)}</Stat>
          <Stat label={m.grading_assumed_count()}>{Object.keys(scores).length}</Stat>
        </div>
      ) : null}
    </section>
  )
}
