import type { Gradebook, GradebookSummary, ScaleBand } from '@semestra/api-client'
import {
  gradingCourseResultUpdateMutation,
  gradingScoreSuggestMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { useId } from 'react'
import { toastError } from '@/lib/errors'
import { formatCredits, formatGpa } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Field, FieldLabel } from '@/ui/field'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/select'
import { GRADE_MASK, maskedPercentText, percentText } from '../display'
import { invalidateGrading, useGradingScale } from '../queries'
import type { WhatIf } from '../whatif'
import { requiredText } from './Stat'

/** One choice of the target picker: a grade point value and the band(s) that give it. */
type TargetOption = { value: string; points: number; letter: string | null; min: number | null }

/**
 * The scale's grade point values from high to low, each with the lowest percentage that earns it;
 * a saved target off the scale (typed before, or on another scale) stays as its own choice.
 */
function targetOptions(bands: readonly ScaleBand[], current: number): TargetOption[] {
  const byPoints = new Map<number, TargetOption>()
  for (const band of bands.toSorted((a, b) => a.min - b.min)) {
    const seen = byPoints.get(band.points)
    // The lowest band of a value sets the threshold; the highest names it (A+ over A).
    if (seen) seen.letter = band.letter ?? seen.letter
    else
      byPoints.set(band.points, {
        value: String(band.points),
        points: band.points,
        letter: band.letter ?? null,
        min: band.min,
      })
  }
  if (!byPoints.has(current))
    byPoints.set(current, { value: String(current), points: current, letter: null, min: null })
  return [...byPoints.values()].filter((o) => o.points > 0).toSorted((a, b) => b.points - a.points)
}

/** A choice as text: "3.7 · A− (≥ 80%)"; with GPA hidden only the threshold shows. */
function optionLabel(option: TargetOption, hideGpa: boolean): string {
  const threshold = option.min === null ? '' : `≥ ${percentText(option.min)}`
  if (hideGpa) return threshold || GRADE_MASK
  const grade = [formatGpa(option.points, 1), option.letter].filter(Boolean).join(' · ')
  return threshold ? `${grade} (${threshold})` : grade
}

/**
 * The course's goal (saved) picked from the scale, and what the remaining work has to average to
 * reach it. In plan mode the same goal drives the assumptions: the figures count them, and
 * "fill in" writes the assumptions that reach it.
 */
export function CourseTarget({
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
  const queryClient = useQueryClient()
  const { summary: s, scale, course_id: courseId, program_id: programId } = gradebook
  const bands = useGradingScale(programId).data?.bands ?? []
  const items = targetOptions(bands, s.target_points).map((o) => ({
    value: o.value,
    label: optionLabel(o, scale.hide_grades),
  }))
  const update = useMutation({
    ...gradingCourseResultUpdateMutation(),
    onError: toastError,
    onSuccess: () => invalidateGrading(queryClient),
  })
  const suggest = useMutation({ ...gradingScoreSuggestMutation(), onError: toastError })
  const pick = (value: string | null) => {
    if (value === null) return
    // "Out of reach" was the answer for the old target.
    suggest.reset()
    update.mutate({ path: { course_id: courseId }, body: { target_points: Number(value) } })
  }
  const autoFill = () =>
    suggest.mutate(
      { path: { course_id: courseId }, body: { target: null } },
      {
        onSuccess: (result) =>
          onChange({
            ...whatIf,
            scores: Object.fromEntries(result.items.map((i) => [i.assessment_id, i.score])),
          }),
      },
    )
  const figures = planning ? planned : s
  const selectId = useId()
  // With GPA hidden the choices are only thresholds, so the picker is named after the grade.
  const label = scale.hide_grades ? m.grading_target_grade() : m.grading_target_gpa()
  return (
    <section aria-label={label} className="mt-3 space-y-2 border-t border-border pt-3">
      <Field>
        <FieldLabel htmlFor={selectId}>{label}</FieldLabel>
        <Select value={String(s.target_points)} onValueChange={pick} items={items}>
          <SelectTrigger id={selectId} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {items.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
      <p className="text-sm">
        {figures && figures.remaining_weight === 0 ? (
          <span className="font-medium">{requiredText(figures, scale.hide_grades)}</span>
        ) : (
          <>
            <span className="text-muted-foreground">
              {m.grading_target_needed_rest({
                remaining: formatCredits((figures ?? s).remaining_weight),
              })}
            </span>{' '}
            <span className="font-medium tabular-nums">
              {figures ? requiredText(figures, scale.hide_grades) : '—'}
            </span>
          </>
        )}
      </p>
      {planning ? (
        <Button
          variant="secondary"
          size="sm"
          className="w-full"
          disabled={suggest.isPending}
          onClick={autoFill}
        >
          <Sparkles aria-hidden />
          {m.grading_autofill()}
        </Button>
      ) : null}
      {planning && suggest.data && !suggest.data.reachable ? (
        <output className="block text-xs text-destructive">
          {m.grading_autofill_unreachable({
            best: maskedPercentText(suggest.data.resulting_percentage, scale.hide_grades),
          })}
        </output>
      ) : null}
    </section>
  )
}
