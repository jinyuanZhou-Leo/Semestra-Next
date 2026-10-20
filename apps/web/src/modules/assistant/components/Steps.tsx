import { Link } from '@tanstack/react-router'
import { AlertCircle, ArrowRight, Brain, Check, CircleDashed, Loader2, X } from 'lucide-react'
import { type ReactNode, useState } from 'react'
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
import type { Step, StepStatus, ViewItem } from '../transcript'
import { Markdown } from './Markdown'
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

const NO_CITATIONS = new Map()

function summary(thinkingMs: number | null, steps: number): string {
  const parts: string[] = []
  if (thinkingMs !== null) {
    parts.push(m.assistant_thought_for({ seconds: Math.max(1, Math.round(thinkingMs / 1000)) }))
  }
  if (steps > 0) {
    parts.push(
      steps === 1 ? m.assistant_thought_one_step() : m.assistant_thought_steps({ count: steps }),
    )
  }
  return parts.length > 0 ? parts.join(' · ') : m.assistant_thought()
}

/**
 * What the model did before it answered (AI Elements "Chain of Thought"): its reasoning, words
 * said before calling tools and the tool calls, in order. Open while the model works, folded as
 * soon as the answer starts; once the user opens or closes it, it stays that way. A call waiting
 * for the user is not a line here: its confirmation card stands in for it until it is answered.
 */
export function Thinking({
  item,
  active,
  showReasoning,
}: {
  item: Extract<ViewItem, { kind: 'assistant' }>
  /** This answer is being written now. */
  active: boolean
  /** The account setting: show the model's thinking text. */
  showReasoning: boolean
}) {
  const [chosen, setChosen] = useState<boolean | null>(null)
  const entries = item.process.filter((entry) =>
    entry.kind === 'reasoning'
      ? showReasoning
      : entry.kind !== 'step' || entry.step.status !== 'waiting',
  )
  const thinking = active && !item.answer
  const reasoned = item.process.some((entry) => entry.kind === 'reasoning')
  if (!thinking && entries.length === 0 && !(reasoned && item.thinkingMs !== null)) return null

  const steps = item.steps.filter((step) => step.status !== 'waiting').length
  const line = (
    <TraceLine status={thinking ? 'running' : undefined}>
      <TraceIcon>
        <Brain />
      </TraceIcon>
      <TraceTitle>{thinking ? m.assistant_thinking() : summary(item.thinkingMs, steps)}</TraceTitle>
    </TraceLine>
  )
  return (
    <Trace aria-label={m.assistant_steps_label()}>
      {entries.length === 0 ? (
        line
      ) : (
        <TraceCollapsible open={chosen ?? thinking} onOpenChange={setChosen}>
          <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
          <TraceCollapsibleContent className="flex flex-col gap-3">
            {entries.map((entry) =>
              entry.kind === 'step' ? (
                <StepRow key={entry.key} step={entry.step} status={entry.step.status as Shown} />
              ) : (
                <Markdown
                  key={entry.key}
                  text={entry.text}
                  citations={NO_CITATIONS}
                  className="text-muted-foreground"
                />
              ),
            )}
          </TraceCollapsibleContent>
        </TraceCollapsible>
      )}
    </Trace>
  )
}
