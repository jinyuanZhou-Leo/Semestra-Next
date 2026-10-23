import type { Gradebook, GradebookSummary, GradeTarget } from '@semestra/api-client'
import {
  gradingCourseResultUpdateMutation,
  gradingScoreSuggestMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { toastError } from '@/lib/errors'
import { formatCredits, formatGpa } from '@/lib/format'
import { SEGMENT, SEGMENTED } from '@/lib/segmented'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group'
import { percentText } from '../display'
import { invalidateGrading } from '../queries'
import { parseDecimal } from '../score'
import type { WhatIf } from '../whatif'
import { InlineInput } from './InlineInput'
import { requiredText } from './Stat'

/** The course's own goal in grade points (saved) and what the remaining work has to average. */
function CourseTarget({ gradebook }: { gradebook: Gradebook }) {
  const queryClient = useQueryClient()
  const { summary: s, scale } = gradebook
  const update = useMutation({
    ...gradingCourseResultUpdateMutation(),
    onError: toastError,
    onSuccess: () => invalidateGrading(queryClient),
  })
  const save = (text: string): boolean => {
    const value = parseDecimal(text)
    if (value === null || value > scale.max_points) return false
    update.mutate({ path: { course_id: gradebook.course_id }, body: { target_points: value } })
    return true
  }
  return (
    <section aria-label={m.grading_target_gpa()} className="rounded-2xl border border-border p-4">
      <p className="text-xs text-muted-foreground">{m.grading_target_gpa()}</p>
      <div className="mt-1 flex items-center gap-1">
        <InlineInput
          key={`t-${s.target_points}`}
          label={m.grading_target_points()}
          value={String(s.target_points)}
          onCommit={save}
          className="-ml-3 h-9 w-auto min-w-10 text-left text-2xl font-semibold field-sizing-content md:text-2xl"
        />
        {s.target_percentage === null ? null : (
          <span className="text-sm text-muted-foreground tabular-nums">
            ≥ {percentText(s.target_percentage)}
          </span>
        )}
      </div>
      <p className="mt-2 text-sm">
        {s.remaining_weight === 0 ? (
          <span className="font-medium">{requiredText(s)}</span>
        ) : (
          <>
            <span className="text-muted-foreground">
              {m.grading_target_needed_rest({ remaining: formatCredits(s.remaining_weight) })}
            </span>{' '}
            <span className="font-medium tabular-nums">{requiredText(s)}</span>
          </>
        )}
      </p>
    </section>
  )
}

/**
 * The goal of this exploration (not saved), in grade points or percent, what the assumed and
 * remaining work still has to average, and filling the assumptions in to reach it.
 */
function PlanTarget({
  gradebook,
  planned,
  whatIf,
  onChange,
}: {
  gradebook: Gradebook
  planned: GradebookSummary | null
  whatIf: WhatIf
  onChange: (next: WhatIf) => void
}) {
  const { course_id: courseId, summary, scale } = gradebook
  const suggest = useMutation({ ...gradingScoreSuggestMutation(), onError: toastError })
  const target = whatIf.target
  const kind = target?.kind ?? 'points'
  const shown = target?.value ?? summary.target_points
  const setTarget = (next: GradeTarget | null) => {
    // "Out of reach" was the answer for the old target.
    suggest.reset()
    onChange({ ...whatIf, target: next })
  }
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
      aria-label={m.grading_plan_target()}
      className="space-y-3 rounded-2xl border border-primary/30 p-4"
    >
      <div className="flex items-center gap-2">
        <p className="flex-1 text-xs text-muted-foreground">{m.grading_plan_target()}</p>
        {target === null ? (
          <span className="text-xs text-muted-foreground tabular-nums">
            {m.grading_course_target({ value: formatGpa(summary.target_points) })}
          </span>
        ) : (
          <Button variant="link" size="xs" className="h-auto px-0" onClick={() => setTarget(null)}>
            {m.grading_plan_target_reset()}
          </Button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <InlineInput
          key={`pt-${kind}-${shown}`}
          label={m.grading_plan_target()}
          value={String(shown)}
          onCommit={(text) => {
            const value = parseDecimal(text)
            const max = kind === 'points' ? scale.max_points : 1000
            if (value === null || value > max) return false
            setTarget({ kind, value })
            return true
          }}
          className="w-20 border-input text-left text-base font-semibold"
        />
        <ToggleGroup
          aria-label={m.grading_target_kind()}
          size="sm"
          className={SEGMENTED}
          value={[kind]}
          onValueChange={([next]) => {
            if (!next || next === kind) return
            const unit = next === 'percentage' ? 'percentage' : 'points'
            // Switching the unit starts from the equivalent of the course's own goal.
            const value =
              unit === 'points' ? summary.target_points : (summary.target_percentage ?? 90)
            setTarget({ kind: unit, value })
          }}
        >
          <ToggleGroupItem value="points" className={SEGMENT}>
            {m.grading_target_points()}
          </ToggleGroupItem>
          <ToggleGroupItem value="percentage" className={SEGMENT}>
            {m.grading_target_percentage()}
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      <p className="text-sm">
        {planned && planned.remaining_weight === 0 ? (
          // Every item has a score or an assumption: the plan either reaches the goal or not.
          <span className="font-medium text-primary">
            {planned.reachable === false
              ? m.grading_required_unreachable()
              : m.grading_required_secured()}
          </span>
        ) : (
          <>
            <span className="text-muted-foreground">
              {m.grading_target_needed_rest({
                remaining: formatCredits((planned ?? summary).remaining_weight),
              })}
            </span>{' '}
            <span className={cn('font-medium tabular-nums', planned && 'text-primary')}>
              {planned ? requiredText(planned) : '—'}
            </span>
          </>
        )}
      </p>
      <Button
        variant="outline"
        size="sm"
        className="w-full"
        disabled={suggest.isPending}
        onClick={autoFill}
      >
        <Sparkles aria-hidden />
        {m.grading_autofill()}
      </Button>
      {suggest.data && !suggest.data.reachable ? (
        <output className="block text-xs text-destructive">
          {m.grading_autofill_unreachable({
            best: percentText(suggest.data.resulting_percentage),
          })}
        </output>
      ) : null}
    </section>
  )
}

/** The target card; in plan mode the same place holds the exploration's own goal. */
export function TargetCard({
  gradebook,
  planning,
  planned,
  whatIf,
  onChange,
}: {
  gradebook: Gradebook
  planning: boolean
  planned: GradebookSummary | null
  whatIf: WhatIf
  onChange: (next: WhatIf) => void
}) {
  if (!planning) return <CourseTarget gradebook={gradebook} />
  return <PlanTarget gradebook={gradebook} planned={planned} whatIf={whatIf} onChange={onChange} />
}
