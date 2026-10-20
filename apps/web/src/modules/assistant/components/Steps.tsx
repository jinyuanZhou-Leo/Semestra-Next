import { agentSkillsListOptions } from '@semestra/api-client/react-query'
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
import {
  capabilityTitle,
  fieldLabel,
  formatValue,
  plainArgs,
  skillTitle,
  stepLine,
} from '../labels'
import type { ProcessEntry, Step, StepStatus, ViewItem } from '../transcript'
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

/** The arguments as a short list, without ids (the line names what they point to). */
function ArgList({ args }: { args: [string, unknown][] }) {
  return (
    <dl className="space-y-1 text-sm">
      {args.map(([key, value]) => (
        <div key={key} className="flex flex-wrap items-baseline gap-x-2">
          <dt className="text-muted-foreground">{fieldLabel(key)}</dt>
          <dd className="min-w-0">{formatValue(value)}</dd>
        </div>
      ))}
    </dl>
  )
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
  const proposal = step.proposal
  const link = status === 'done' && proposal ? proposalLink(proposal) : null
  const args = proposal ? [] : plainArgs(step.args)
  if (status === 'running' || (args.length === 0 && !proposal && !step.errorCode)) return line
  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="space-y-2">
        {proposal ? <ProposalChanges proposal={proposal} /> : null}
        {args.length > 0 ? <ArgList args={args} /> : null}
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

/** What the model did in one step: the sentence it said first, and the calls it made then. */
type Group = { key: string; title: string | null; entries: ProcessEntry[] }

function groupBySteps(entries: ProcessEntry[]): Group[] {
  const groups: Group[] = []
  for (const entry of entries) {
    const last = groups.at(-1)
    const group =
      last?.key === entry.message ? last : { key: entry.message, title: null, entries: [] }
    if (group !== last) groups.push(group)
    if (entry.kind === 'text' && group.title === null) group.title = headline(entry.text)
    else group.entries.push(entry)
  }
  return groups
}

/** The sentence as a heading: its first line, without Markdown marks. */
function headline(text: string): string {
  return (text.trim().split('\n')[0] ?? '').replace(/[*_`#>]/g, '').trim()
}

/**
 * One step of the model under the sentence it said before its tool calls ("Reading the file to
 * find the term dates"): folded to that line with how many calls it made, open while it runs.
 */
function StepGroup({
  group,
  skillTitles,
}: {
  group: Group
  skillTitles: ReadonlyMap<string, string>
}) {
  const [chosen, setChosen] = useState<boolean | null>(null)
  const steps = group.entries.flatMap((entry) => (entry.kind === 'step' ? [entry.step] : []))
  const running = steps.some((step) => step.status === 'running')
  const failed = steps.some((step) => step.status === 'error')
  if (steps.length === 0) {
    return (
      <>
        <Markdown
          text={group.title ?? ''}
          citations={NO_CITATIONS}
          className="text-muted-foreground"
        />
        {group.entries.map((entry) => (
          <Entry key={entry.key} entry={entry} skillTitles={skillTitles} />
        ))}
      </>
    )
  }
  const icon = running ? <Loader2 className="animate-spin" /> : failed ? <AlertCircle /> : <Check />
  return (
    <TraceCollapsible open={chosen ?? running} onOpenChange={setChosen}>
      <TraceCollapsibleTrigger>
        <TraceLine status={running ? 'running' : failed ? 'error' : undefined}>
          <TraceIcon>{icon}</TraceIcon>
          <TraceTitle className="text-foreground">{group.title}</TraceTitle>
          <TraceDescription>
            {steps.length === 1
              ? m.assistant_thought_one_step()
              : m.assistant_thought_steps({ count: steps.length })}
          </TraceDescription>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="flex flex-col gap-3 border-l pl-4">
        {group.entries.map((entry) => (
          <Entry key={entry.key} entry={entry} skillTitles={skillTitles} />
        ))}
      </TraceCollapsibleContent>
    </TraceCollapsible>
  )
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
  const skills = useQuery({ ...agentSkillsListOptions(), staleTime: 5 * 60_000 }).data?.items
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
  const line = (
    <TraceLine status={thinking ? 'running' : undefined}>
      <TraceIcon>
        <Brain />
      </TraceIcon>
      <TraceTitle>
        {thinking ? m.assistant_thinking() : summary(item.thinkingMs, steps, changes)}
      </TraceTitle>
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
            {groupBySteps(entries).map((group) =>
              group.title === null ? (
                group.entries.map((entry) => (
                  <Entry key={entry.key} entry={entry} skillTitles={skillTitles} />
                ))
              ) : (
                <StepGroup key={group.key} group={group} skillTitles={skillTitles} />
              ),
            )}
          </TraceCollapsibleContent>
        </TraceCollapsible>
      )}
    </Trace>
  )
}
