import { AlertCircle, Check, CircleDashed, CirclePause, Loader2, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { errorMessage } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from '@/ui/trace'
import { capabilityTitle } from '../labels'
import type { Step, StepStatus } from '../transcript'

const STATUS_ICON: Record<StepStatus, ReactNode> = {
  running: <Loader2 className="animate-spin" />,
  done: <Check />,
  error: <AlertCircle />,
  waiting: <CirclePause />,
  rejected: <X />,
  expired: <CircleDashed />,
}

const STATUS_TEXT: Record<StepStatus, () => string> = {
  running: m.assistant_step_running,
  done: m.assistant_step_done,
  error: m.assistant_step_failed,
  waiting: m.assistant_step_waiting,
  rejected: m.assistant_step_rejected,
  expired: m.assistant_step_expired,
}

function traceStatus(status: StepStatus): 'running' | 'error' | 'pending' | undefined {
  if (status === 'running') return 'running'
  if (status === 'error') return 'error'
  if (status === 'waiting' || status === 'expired' || status === 'rejected') return 'pending'
  return undefined
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

function StepRow({ step }: { step: Step }) {
  const args = Object.entries(step.args)
  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger>
        <TraceLine status={traceStatus(step.status)}>
          <TraceIcon>{STATUS_ICON[step.status]}</TraceIcon>
          <TraceTitle>{capabilityTitle(step.name)}</TraceTitle>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <dl className="space-y-1 text-xs">
          <div className="flex gap-2">
            <dt className="shrink-0 text-muted-foreground">{m.assistant_step_status()}</dt>
            <dd>
              {STATUS_TEXT[step.status]()}
              {step.errorCode ? ` · ${errorMessage({ error: { code: step.errorCode } })}` : ''}
            </dd>
          </div>
          {args.map(([key, value]) => (
            <div key={key} className="flex gap-2">
              <dt className="shrink-0 font-mono text-muted-foreground">{key}</dt>
              <dd className="min-w-0 truncate font-mono">{formatValue(value)}</dd>
            </div>
          ))}
        </dl>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  )
}

/** The tool calls of an answer, one collapsible line each: what ran and how it went. */
export function Steps({ steps }: { steps: readonly Step[] }) {
  if (steps.length === 0) return null
  return (
    <Trace aria-label={m.assistant_steps_label()} className="gap-1.5">
      {steps.map((step) => (
        <StepRow key={step.callId} step={step} />
      ))}
    </Trace>
  )
}
