import type { Gradebook, GradebookSummary } from '@semestra/api-client'
import { gradingCourseResultUpdateMutation } from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { TriangleAlert, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { toastError } from '@/lib/errors'
import { formatCredits } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { Alert, AlertDescription } from '@/ui/alert'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { percentText } from '../display'
import { invalidateGrading } from '../queries'
import { AnimatedPercent } from './AnimatedPercent'
import { GpaValue } from './GpaValue'
import { InlineInput } from './InlineInput'

export function Stat({
  label,
  children,
  hint,
}: {
  label: string
  children: ReactNode
  hint?: ReactNode
}) {
  return (
    <div className="rounded-2xl border border-border p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{children}</div>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

/** The target in words: what the remaining work has to average, or that it is settled. */
export function requiredText(s: GradebookSummary): string {
  if (s.reachable === false) return m.grading_required_unreachable()
  if (s.required_average === null) return '—'
  if (s.required_average <= 0) return m.grading_required_secured()
  return percentText(s.required_average)
}

/** Result, weights, target and forecast of a course, plus the official-grade override (M03 §5.1). */
export function SummaryStrip({ gradebook }: { gradebook: Gradebook }) {
  const queryClient = useQueryClient()
  const { summary: s, result, scale } = gradebook
  const update = useMutation({
    ...gradingCourseResultUpdateMutation(),
    onError: toastError,
    onSuccess: () => invalidateGrading(queryClient),
  })
  const patch = (body: Parameters<typeof update.mutate>[0]['body']) =>
    update.mutate({ path: { course_id: gradebook.course_id }, body })

  const saveTarget = (text: string): boolean => {
    const value = Number(text.replace(',', '.'))
    if (text.trim() === '' || !(value >= 0 && value <= scale.max_points)) return false
    patch({ target_points: value })
    return true
  }
  const saveOverride = (text: string): boolean => {
    if (text.trim() === '') {
      patch({ final_override_percentage: null })
      return true
    }
    const value = Number(text.replace('%', '').replace(',', '.'))
    if (!(value >= 0 && value <= 1000)) return false
    patch({ final_override_percentage: value })
    return true
  }

  const final = s.final_percentage ?? s.current_percentage
  const finalPoints = s.final_percentage === null ? s.current_points : s.final_points
  const letter = s.final_percentage === null ? s.current_letter : s.final_letter

  return (
    <div className="space-y-3">
      {s.weights_ok ? null : (
        <Alert>
          <TriangleAlert aria-hidden />
          <AlertDescription>
            {m.grading_weights_warning({
              total: formatCredits(s.weight_total),
              gap: formatCredits(Math.abs(s.weight_gap)),
            })}
          </AlertDescription>
        </Alert>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label={s.final_percentage === null ? m.grading_current() : m.grading_final()}
          hint={
            <span className="inline-flex flex-wrap items-center gap-x-2">
              {letter ? <span>{letter}</span> : null}
              <span>
                {m.grading_gpa()}{' '}
                <GpaValue
                  value={finalPoints}
                  hidden={scale.hide_gpa}
                  animated
                  className="tabular-nums"
                />
              </span>
              {s.overridden ? <Badge variant="secondary">{m.grading_overridden()}</Badge> : null}
            </span>
          }
        >
          {s.weights_ok || s.overridden ? <AnimatedPercent value={final} /> : '—'}
        </Stat>
        <Stat
          label={m.grading_weights()}
          hint={m.grading_weights_split({
            graded: formatCredits(s.graded_weight),
            remaining: formatCredits(s.remaining_weight),
          })}
        >
          {formatCredits(s.weight_total)}%
        </Stat>
        <Stat
          label={m.grading_target()}
          hint={
            <>
              {m.grading_target_needed()}: <span className="font-medium">{requiredText(s)}</span>
            </>
          }
        >
          <InlineInput
            key={`t-${s.target_points}`}
            label={m.grading_target_points()}
            value={String(s.target_points)}
            onCommit={saveTarget}
            className="-ml-3 h-9 w-24 text-left text-2xl font-semibold md:text-2xl"
          />
        </Stat>
        <Stat label={m.grading_forecast()} hint={s.forecast_letter ?? m.grading_forecast_hint()}>
          {percentText(s.forecast_percentage)}
        </Stat>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">{m.grading_official_grade()}</span>
        <InlineInput
          key={`o-${result.final_override_percentage ?? ''}`}
          label={m.grading_official_grade()}
          placeholder={m.grading_official_placeholder()}
          value={
            result.final_override_percentage === null
              ? ''
              : String(result.final_override_percentage)
          }
          onCommit={saveOverride}
          className="w-28 border-input"
        />
        {result.final_override_percentage === null ? null : (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => patch({ final_override_percentage: null })}
          >
            <X aria-hidden />
            {m.grading_official_clear()}
          </Button>
        )}
      </div>
    </div>
  )
}
