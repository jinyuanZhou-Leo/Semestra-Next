import { Check, LoaderCircle, RotateCcw, Sparkles, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSmoothedProgress } from '@/hooks/use-smoothed-progress'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { ProgressBar, ProgressRing } from './Progress'

export type AiActionState = 'idle' | 'running' | 'success' | 'error'
export type AiActionVariant = 'integrated' | 'anchored' | 'radial'

type AiActionProps = {
  state: AiActionState
  /** What the action does, e.g. "Fill from syllabus". Shown while idle. */
  label: string
  /** 0–100 from the backend; omit for an indeterminate task. */
  progress?: number
  /** Running text, e.g. `useJob().stageLabel`; defaults to a generic "Working". */
  stageLabel?: string
  /** Inline reason shown in the error state. */
  error?: string | null
  variant?: AiActionVariant
  cancelling?: boolean
  onClick?: () => void
  onCancel?: () => void
  disabled?: boolean
  className?: string
}

const SUCCESS_MS = 1_200

/**
 * Starts an AI or background task and shows its progress in place (M00 §4.7.1). Deliberately quiet
 * (M06): theme colours only, no glow or sheen; motion respects `prefers-reduced-motion`.
 */
export function AiAction({
  state,
  label,
  progress,
  stageLabel,
  error,
  variant = 'integrated',
  cancelling = false,
  onClick,
  onCancel,
  disabled = false,
  className,
}: AiActionProps) {
  // `success` is shown briefly, then the action is ready again.
  const [successExpired, setSuccessExpired] = useState(false)
  const [lastState, setLastState] = useState(state)
  if (lastState !== state) {
    setLastState(state)
    setSuccessExpired(false)
  }
  useEffect(() => {
    if (state !== 'success') return
    const timer = window.setTimeout(() => setSuccessExpired(true), SUCCESS_MS)
    return () => window.clearTimeout(timer)
  }, [state])
  const shown: AiActionState = state === 'success' && successExpired ? 'idle' : state

  const running = shown === 'running'
  const hasProgress = progress != null
  const displayed = Math.round(useSmoothedProgress(progress ?? 0, running && hasProgress))
  const text =
    shown === 'running'
      ? cancelling
        ? m.ai_action_cancelling()
        : (stageLabel ?? m.job_running())
      : shown === 'success'
        ? m.ai_action_done()
        : shown === 'error'
          ? m.ai_action_retry()
          : label
  const percent = running && hasProgress ? `${displayed}%` : ''
  // Screen readers get the real value; the smoothed one is only visual.
  const statusText = running && hasProgress ? `${text}, ${Math.round(progress)}%` : text
  const clickable = !disabled && (shown === 'idle' || shown === 'error') && onClick != null
  const Icon = { idle: Sparkles, running: LoaderCircle, success: Check, error: RotateCcw }[shown]
  const icon = (
    <Icon
      aria-hidden="true"
      className={cn(
        'size-4',
        running && 'motion-safe:animate-spin',
        shown === 'success' && 'text-success',
      )}
    />
  )
  // Re-key by the text without numbers so counts like 3/12 don't re-run the fade.
  const labelNode = (
    <span
      key={`${shown}-${text.replace(/\d+/g, '#')}`}
      className="min-w-0 flex-1 truncate text-left motion-safe:animate-in motion-safe:fade-in"
    >
      {text}
    </span>
  )
  const percentNode = (
    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{percent}</span>
  )

  const button =
    variant === 'radial' ? (
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!clickable}
        onClick={onClick}
        className={cn('max-w-56 justify-start gap-2 disabled:opacity-100', className)}
      >
        <span className="relative flex size-5 items-center justify-center text-primary">
          {running ? (
            <ProgressRing value={hasProgress ? displayed : 0} className="absolute inset-0" />
          ) : null}
          {running ? null : icon}
        </span>
        {labelNode}
        {percentNode}
      </Button>
    ) : variant === 'anchored' ? (
      <div
        className={cn(
          'inline-flex w-64 flex-col overflow-hidden rounded-xl border bg-background',
          className,
        )}
      >
        <Button
          type="button"
          variant="ghost"
          disabled={!clickable}
          onClick={onClick}
          className="h-9 justify-start rounded-none disabled:opacity-100"
        >
          <span className="text-primary">{icon}</span>
          {labelNode}
          {percentNode}
        </Button>
        <ProgressBar
          value={shown === 'success' ? 100 : running ? displayed : 0}
          tone={shown === 'success' ? 'success' : 'default'}
          label={statusText}
          className="rounded-none"
        />
      </div>
    ) : (
      <Button
        type="button"
        variant={shown === 'idle' ? 'default' : 'outline'}
        disabled={!clickable}
        onClick={onClick}
        className={cn('relative overflow-hidden disabled:opacity-100', className)}
      >
        {running ? (
          <span
            aria-hidden="true"
            className="absolute inset-y-0 left-0 bg-primary/10 transition-[width] duration-300 motion-reduce:transition-none"
            style={{ width: `${hasProgress ? displayed : 0}%` }}
          />
        ) : null}
        <span className="relative flex min-w-0 items-center gap-1.5">
          {icon}
          {labelNode}
          {percentNode}
        </span>
      </Button>
    ) // fmt: skip

  return (
    <div className="inline-flex flex-col gap-1">
      <div className="inline-flex items-center gap-1.5">
        {button}
        {running && onCancel ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={cancelling}
            aria-label={cancelling ? m.ai_action_cancelling() : m.ai_action_cancel()}
            onClick={onCancel}
          >
            <X aria-hidden="true" />
          </Button>
        ) : null}
      </div>
      {shown === 'error' && error ? <p className="text-xs text-destructive">{error}</p> : null}
      <output aria-live="polite" className="sr-only">
        {statusText}
      </output>
    </div>
  )
}
