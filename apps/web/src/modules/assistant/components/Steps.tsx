import { Link } from '@tanstack/react-router'
import { AlertCircle, ArrowRight, Check, CircleDashed, Loader2, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { errorMessage } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { CodeBlock, CodeBlockContent } from '@/ui/code-block'
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
import { ProposalChanges, proposalLink } from './ProposalCard'

type Shown = Exclude<StepStatus, 'waiting'>

const ICON: Record<Shown, ReactNode> = {
  running: <Loader2 className="animate-spin" />,
  done: <Check />,
  error: <AlertCircle />,
  rejected: <X />,
  expired: <CircleDashed />,
}

const TITLE: Record<Shown, (inputs: { name: string }) => string> = {
  running: m.assistant_step_line_running,
  done: m.assistant_step_line_done,
  error: m.assistant_step_line_failed,
  rejected: m.assistant_step_line_rejected,
  expired: m.assistant_step_line_expired,
}

function traceStatus(status: Shown): 'running' | 'error' | undefined {
  if (status === 'running') return 'running'
  if (status === 'error') return 'error'
  return undefined
}

function argsText(args: Record<string, unknown>): string {
  return Object.keys(args).length > 0 ? JSON.stringify(args, null, 2) : ''
}

/**
 * One tool call (AI Elements "Tool"): a line while it runs, and a line that opens to what
 * it was given, what it changed and why it failed once it has finished.
 */
function StepRow({ step, status }: { step: Step; status: Shown }) {
  const line = (
    <TraceLine status={traceStatus(status)}>
      <TraceIcon>{ICON[status]}</TraceIcon>
      <TraceTitle>{TITLE[status]({ name: capabilityTitle(step.name) })}</TraceTitle>
    </TraceLine>
  )
  const proposal = step.proposal
  const link = status === 'done' && proposal ? proposalLink(proposal) : null
  const args = proposal ? '' : argsText(step.args)
  if (status === 'running' || (!args && !proposal && !step.errorCode)) return line
  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="space-y-2">
        {proposal ? <ProposalChanges proposal={proposal} /> : null}
        {args ? (
          <CodeBlock size="sm">
            <CodeBlockContent wrap className="max-h-64">
              {args}
            </CodeBlockContent>
          </CodeBlock>
        ) : null}
        {step.errorCode ? (
          <CodeBlock size="sm" variant="destructive">
            <CodeBlockContent wrap>
              {errorMessage({ error: { code: step.errorCode } })}
            </CodeBlockContent>
          </CodeBlock>
        ) : null}
        {link ? (
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0"
            nativeButton={false}
            render={<Link to={link} />}
          >
            {m.assistant_proposal_open()}
            <ArrowRight aria-hidden />
          </Button>
        ) : null}
      </TraceCollapsibleContent>
    </TraceCollapsible>
  )
}

/**
 * The tool calls of an answer in one Trace. A call waiting for the user is not a line here:
 * its confirmation card stands in for it until it is answered.
 */
export function Steps({ steps }: { steps: readonly Step[] }) {
  const shown = steps.filter((step) => step.status !== 'waiting')
  if (shown.length === 0) return null
  return (
    <Trace aria-label={m.assistant_steps_label()}>
      {shown.map((step) => (
        <StepRow key={step.callId} step={step} status={step.status as Shown} />
      ))}
    </Trace>
  )
}
