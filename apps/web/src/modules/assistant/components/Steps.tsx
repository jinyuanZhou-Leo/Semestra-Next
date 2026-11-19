import { agentSkillListOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { AlertCircle, ArrowRight, Brain, Check, CircleDashed, Loader2, X } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { errorMessage } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { CodeBlock, CodeBlockContent } from '@/ui/code-block'
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from '@/ui/trace'
import { capabilityTitle, skillTitle, stepLine } from '../labels'
import type { ProcessEntry, Step, StepStatus, ViewItem } from '../transcript'
import { Markdown } from './Markdown'
import { ChangeList, proposalChanges, proposalLink } from './ProposalCard'

type Shown = Exclude<StepStatus, 'waiting'>

const ICON: Record<Shown, ReactNode> = {
  running: <Loader2 className="animate-spin" />,
  done: <Check />,
  error: <AlertCircle />,
  rejected: <X />,
  expired: <CircleDashed />,
}

/** How a step that did not simply run says so; a step that ran is just its title. */
const TITLE: Partial<Record<Shown, (inputs: { name: string }) => string>> = {
  running: m.assistant_step_line_running,
  error: m.assistant_step_line_failed,
  rejected: m.assistant_step_line_rejected,
  expired: m.assistant_step_line_expired,
}

function traceStatus(status: Shown): 'running' | 'error' | undefined {
  if (status === 'running') return 'running'
  if (status === 'error') return 'error'
  return undefined
}

/**
 * One tool call (AI Elements "Tool"): what it did and to what, by name, with a few facts
 * ("pages 1–4", "11 courses"); it opens to its arguments in words, what it changed and why it
 * failed.
 */
function StepRow({
  step,
  status,
  skillTitles,
}: {
  step: Step
  status: Shown
  skillTitles: ReadonlyMap<string, string>
}) {
  const title = capabilityTitle(step.name)
  const said = stepLine(step, skillTitles)
  const label = TITLE[status]?.({ name: title }) ?? title
  const line = (
    <TraceLine status={traceStatus(status)}>
      <TraceIcon>{ICON[status]}</TraceIcon>
      <TraceTitle>
        {label}
        {said.target ? <span className="text-foreground">{` ${said.target}`}</span> : null}
      </TraceTitle>
      {said.details.length > 0 ? (
        <TraceDescription>{said.details.join(' · ')}</TraceDescription>
      ) : null}
      {said.issues > 0 ? (
        <Badge variant="outline">{m.assistant_step_issues({ count: said.issues })}</Badge>
      ) : null}
    </TraceLine>
  )
  // It opens only to what the line cannot say: what a write changed (as its card showed it,
  // or would have when it ran without one) and why a call failed. A read is its line: its
  // arguments are the model's plumbing.
  const proposal = step.proposal
  const changes = proposal
    ? proposalChanges(proposal)
    : step.changed
      ? (step.display?.changes ?? [])
      : []
  const shown = proposal ? proposalLink(proposal) : (step.display?.link?.to ?? null)
  const link = status === 'done' ? shown : null
  if (status === 'running' || (changes.length === 0 && !link && !step.errorCode)) return line
  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="space-y-2">
        <ChangeList
          changes={changes}
          destructive={proposal?.effect === 'destructive'}
          schema={proposal?.input_schema}
        />
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

function Entry({
  entry,
  skillTitles,
}: {
  entry: ProcessEntry
  skillTitles: ReadonlyMap<string, string>
}) {
  if (entry.kind === 'step') {
    return (
      <StepRow step={entry.step} status={entry.step.status as Shown} skillTitles={skillTitles} />
    )
  }
  return <Markdown text={entry.text} citations={NO_CITATIONS} className="text-muted-foreground" />
}

function summary(thinkingMs: number | null, steps: number, changes: number): string {
  const parts: string[] = []
  if (thinkingMs !== null) {
    parts.push(m.assistant_thought_for({ seconds: Math.max(1, Math.round(thinkingMs / 1000)) }))
  }
  if (steps > 0) {
    parts.push(
      steps === 1 ? m.assistant_thought_one_step() : m.assistant_thought_steps({ count: steps }),
    )
  }
  if (changes > 0) parts.push(m.assistant_thought_changes({ count: changes }))
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
  const skills = useQuery({ ...agentSkillListOptions(), staleTime: 5 * 60_000 }).data?.items
  const skillTitles = new Map((skills ?? []).map((s) => [s.name, skillTitle(s.title, s.name)]))
  const entries = item.process.filter((entry) =>
    entry.kind === 'reasoning'
      ? showReasoning
      : entry.kind !== 'step' || entry.step.status !== 'waiting',
  )
  const thinking = active && !item.answer
  const reasoned = item.process.some((entry) => entry.kind === 'reasoning')
  if (!thinking && entries.length === 0 && !(reasoned && item.thinkingMs !== null)) return null

  const shownSteps = item.steps.filter((step) => step.status !== 'waiting')
  const steps = shownSteps.length
  const changes = shownSteps.filter((step) => step.changed).length
  let title = summary(item.thinkingMs, steps, changes)
  if (thinking) title = m.assistant_thinking()
  const line = (
    <TraceLine status={thinking ? 'running' : undefined}>
      <TraceIcon>
        <Brain />
      </TraceIcon>
      <TraceTitle>{title}</TraceTitle>
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
            {entries.map((entry) => (
              <Entry key={entry.key} entry={entry} skillTitles={skillTitles} />
            ))}
          </TraceCollapsibleContent>
        </TraceCollapsible>
      )}
    </Trace>
  )
}
