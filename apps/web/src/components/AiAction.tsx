import { Check, CircleAlert, LoaderCircle, RotateCcw, Sparkles, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSmoothedProgress } from '@/hooks/use-smoothed-progress'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Progress } from '@/ui/progress'

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
const EASE = 'ease-[cubic-bezier(0.22,1,0.36,1)]'

function ActionIcon({ state }: { state: AiActionState }) {
  if (state === 'success') {
    return (
      <span aria-hidden="true" className="relative flex size-4 items-center justify-center">
        <span className="ai-action-success-halo absolute size-5 rounded-full border border-current/35" />
        <Check className="ai-action-success-check size-4" />
      </span>
    )
  }
  const Icon = state === 'error' ? RotateCcw : state === 'running' ? LoaderCircle : Sparkles
  return (
    <Icon
      aria-hidden="true"
      className={cn('size-4', state === 'running' && 'motion-safe:animate-spin')}
    />
  )
}

/**
 * Starts an AI or background task and shows its progress in place (M00 §4.7.1). The look and the
 * motion (button-as-progress-bar, sheen while running, sweep and halo on success, the stop button
 * sliding in) follow bid-analysis-agent's `ai-action`; the CSS is in `app/theme.css`.
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
  // Screen readers get the real value; the smoothed one is only visual.
  const statusText = running && hasProgress ? `${text}, ${Math.round(progress)}%` : text
  const clickable = !disabled && (shown === 'idle' || shown === 'error') && onClick != null
  const fill = shown === 'success' ? 100 : running ? displayed : 0
  const showCancel = running && onCancel != null
  // Re-key by the text without numbers so counts like 3/12 don't re-run the enter animation.
  const labelKey = `${shown}-${text.replace(/\d+/g, '#')}`

  let action
  if (variant === 'anchored') {
    action = (
      <div
        className={cn(
          'w-64 overflow-hidden rounded-xl border bg-background transition-colors duration-200',
          EASE,
          running && 'border-primary/35 bg-primary/[0.025]',
          shown === 'success' && 'border-emerald-600/25',
          shown === 'error' && 'border-destructive/30 bg-destructive/[0.06]',
          className,
        )}
      >
        <Button
          type="button"
          variant="ghost"
          disabled={!clickable}
          onClick={onClick}
          className="h-10 w-full justify-start rounded-none px-3 disabled:opacity-100"
          aria-label={statusText}
        >
          <span
            className={cn(
              'flex size-6 items-center justify-center rounded-md bg-primary/10 text-primary transition-colors duration-200',
              shown === 'success' && 'bg-emerald-600/10 text-emerald-700 dark:text-emerald-400',
              shown === 'error' && 'bg-destructive/10 text-destructive',
            )}
          >
            <ActionIcon state={shown} />
          </span>
          <span
            key={labelKey}
            className="ai-action-state-enter min-w-0 flex-1 truncate text-left leading-none"
          >
            {text}
          </span>
          <span className="inline-flex w-9 shrink-0 justify-end text-xs leading-none text-muted-foreground tabular-nums">
            {running && hasProgress ? `${displayed}%` : ''}
          </span>
        </Button>
        <Progress
          value={fill}
          aria-label={statusText}
          className={cn(
            '[&_[data-slot=progress-track]]:h-0.5 [&_[data-slot=progress-track]]:rounded-none [&_[data-slot=progress-indicator]]:transition-[width,background-color] [&_[data-slot=progress-indicator]]:duration-500',
            shown === 'success' && '[&_[data-slot=progress-indicator]]:bg-emerald-600',
            shown === 'error' && '[&_[data-slot=progress-indicator]]:bg-destructive',
          )}
        />
      </div>
    )
  } else if (variant === 'radial') {
    const circumference = 2 * Math.PI * 9
    action = (
      <Button
        type="button"
        variant="outline"
        disabled={!clickable}
        onClick={onClick}
        className={cn(
          'h-10 w-48 justify-start gap-2.5 px-2.5 disabled:opacity-100',
          running && 'border-primary/35 bg-primary/[0.035]',
          shown === 'success' && 'border-emerald-600/25 text-emerald-700 dark:text-emerald-400',
          shown === 'error' &&
            'border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/15 dark:bg-destructive/15 dark:hover:bg-destructive/20',
          className,
        )}
        aria-label={statusText}
      >
        <span className="relative flex size-6 items-center justify-center">
          <svg className="absolute inset-0 -rotate-90" viewBox="0 0 24 24" aria-hidden="true">
            <circle
              cx="12"
              cy="12"
              r="9"
              fill="none"
              stroke="currentColor"
              strokeOpacity="0.12"
              strokeWidth="2"
            />
            <circle
              cx="12"
              cy="12"
              r="9"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - fill / 100)}
              className={cn(
                'transition-[stroke-dashoffset] duration-500 motion-reduce:transition-none',
                EASE,
              )}
            />
          </svg>
          <span className="scale-75">
            <ActionIcon state={shown} />
          </span>
        </span>
        <span
          key={labelKey}
          className="ai-action-state-enter min-w-0 flex-1 truncate text-left leading-none"
        >
          {text}
        </span>
        <span className="inline-flex w-8 shrink-0 justify-end text-xs leading-none text-muted-foreground tabular-nums">
          {running && hasProgress ? displayed : ''}
        </span>
      </Button>
    )
  } else {
    action = (
      <Button
        type="button"
        variant={shown === 'error' ? 'outline' : 'default'}
        disabled={!clickable}
        onClick={onClick}
        className={cn(
          'relative h-10 w-auto justify-center overflow-hidden px-3 transition-[background-color,border-color,color,box-shadow] duration-300 disabled:opacity-100 motion-reduce:transition-none',
          EASE,
          running && 'bg-primary/90',
          shown === 'success' &&
            'ai-action-success-surface bg-emerald-700 text-white hover:bg-emerald-700',
          shown === 'error' &&
            'border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/15 dark:bg-destructive/15 dark:hover:bg-destructive/20',
          className,
        )}
        aria-label={statusText}
      >
        <span
          aria-hidden="true"
          className={cn(
            'absolute inset-y-0 left-0 w-full origin-left bg-white/10 transition-transform duration-500 motion-reduce:transition-none',
            EASE,
          )}
          style={{ transform: `scaleX(${fill / 100})` }}
        />
        {running ? (
          <span
            aria-hidden="true"
            className="ai-action-sheen absolute inset-0 motion-reduce:hidden"
          />
        ) : null}
        {shown === 'success' ? (
          <span
            aria-hidden="true"
            className="ai-action-success-sweep absolute inset-0 motion-reduce:hidden"
          />
        ) : null}
        <span className="relative flex w-full items-center">
          <span className="mr-2 flex shrink-0 items-center">
            <ActionIcon state={shown} />
          </span>
          <span
            key={labelKey}
            className={cn(
              'ai-action-state-enter min-w-0 truncate leading-none',
              shown === 'idle' ? 'flex-none text-center' : 'flex-1 text-left',
            )}
          >
            {text}
          </span>
          <span
            className={cn(
              'inline-flex w-0 shrink-0 justify-end overflow-hidden text-xs leading-none tabular-nums opacity-0 transition-[width,opacity] duration-200 motion-reduce:transition-none',
              EASE,
              running && hasProgress && 'ml-2 w-9 opacity-80',
            )}
          >
            {running && hasProgress ? `${displayed}%` : ''}
          </span>
        </span>
      </Button>
    )
  }

  return (
    <div className="inline-flex flex-col gap-1">
      {onCancel == null ? (
        action
      ) : (
        // The stop button slides in beside the action while it runs and takes no room otherwise.
        <div
          className={cn(
            'inline-grid grid-cols-[auto_0rem] items-center gap-x-0 transition-[grid-template-columns,column-gap] duration-200 motion-reduce:transition-none',
            EASE,
            showCancel && 'grid-cols-[auto_2.5rem] gap-x-2',
          )}
        >
          {action}
          <div
            className={cn(
              'flex min-w-0 -translate-x-2 items-center justify-start self-stretch overflow-hidden opacity-0 transition-[opacity,transform] duration-150 motion-reduce:transition-none',
              EASE,
              showCancel && 'translate-x-0 opacity-100 delay-75 duration-200 motion-reduce:delay-0',
            )}
            aria-hidden={!showCancel}
          >
            <Button
              type="button"
              variant="destructive"
              disabled={!showCancel || cancelling}
              tabIndex={showCancel ? 0 : -1}
              aria-busy={cancelling}
              aria-label={cancelling ? m.ai_action_cancelling() : m.ai_action_cancel()}
              onClick={onCancel}
              className="aspect-square h-full max-h-10 w-auto shrink-0 rounded-full p-0 disabled:opacity-100"
            >
              {cancelling ? (
                <LoaderCircle aria-hidden className="size-4 motion-safe:animate-spin" />
              ) : (
                <X aria-hidden className="size-4" />
              )}
            </Button>
          </div>
        </div>
      )}
      {shown === 'error' && error ? (
        <p className="flex items-start gap-1.5 text-xs text-destructive">
          <CircleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
          {error}
        </p>
      ) : null}
      <output aria-live="polite" className="sr-only">
        {statusText}
      </output>
    </div>
  )
}
