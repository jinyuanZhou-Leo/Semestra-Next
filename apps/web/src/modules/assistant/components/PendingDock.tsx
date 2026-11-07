import type { AgentProposalOut } from '@semestra/api-client'
import {
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  MessageCircleQuestion,
  PencilLine,
  Trash2,
  X,
} from 'lucide-react'
import { type KeyboardEvent, type ReactNode, useState } from 'react'
import { isEditable } from '@/app/hotkeys'
import { m } from '@/paraglide/messages'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { Checkbox } from '@/ui/checkbox'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/ui/input-group'
import { Item, ItemContent, ItemDescription, ItemTitle } from '@/ui/item'
import { Kbd } from '@/ui/kbd'
import { Label } from '@/ui/label'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { capabilityTitle } from '../labels'
import { ASK_USER } from '../transcript'
import type { Decision } from '../use-chat'
import { EditForm, ProposalChanges, editableFields } from './ProposalCard'

type Option = { label: string; description?: string }
type Question = { question: string; options: Option[]; recommended?: number | null }

export const questionOf = (proposal: AgentProposalOut) => proposal.args as Question

/** What the user answered a question with: their words, or null when they skipped it. */
export function answerOf(proposal: AgentProposalOut): string | null {
  const result = proposal.result as { answer?: unknown } | null
  return proposal.status === 'executed' && typeof result?.answer === 'string' ? result.answer : null
}

function SendButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <InputGroupButton
            size="icon-sm"
            variant="default"
            className="rounded-full"
            aria-label={m.assistant_send()}
            disabled={disabled}
            onClick={onClick}
          />
        }
      >
        <ArrowUp />
      </TooltipTrigger>
      <TooltipContent>{m.assistant_send()}</TooltipContent>
    </Tooltip>
  )
}

/** Moves between the waiting cards when there is more than one. */
function Pager({
  index,
  count,
  onMove,
}: {
  index: number
  count: number
  onMove: (to: number) => void
}) {
  if (count < 2) return null
  return (
    <div className="-my-1 flex shrink-0 items-center text-xs text-muted-foreground tabular-nums">
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={m.assistant_pending_previous()}
        disabled={index === 0}
        onClick={() => onMove(index - 1)}
      >
        <ChevronLeft />
      </Button>
      {m.assistant_pending_position({ index: index + 1, count })}
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={m.assistant_pending_next()}
        disabled={index === count - 1}
        onClick={() => onMove(index + 1)}
      >
        <ChevronRight />
      </Button>
    </div>
  )
}

/**
 * The card in the input's place: a header (icon, title, pager, `end`), its body and, unless
 * `reply` is null, a one-line box at the bottom where typing answers it (Enter sends).
 */
function Panel({
  label,
  icon,
  title,
  pager,
  end,
  children,
  reply,
  onKeyDown,
}: {
  label: string
  icon: ReactNode
  title: ReactNode
  pager: ReactNode
  end?: ReactNode
  children: ReactNode
  reply: {
    value: string
    onChange: (v: string) => void
    placeholder: string
    onSend: () => void
    disabled: boolean
  } | null
  onKeyDown?: (event: KeyboardEvent) => void
}) {
  return (
    // Same frame as the input it stands in for; its focus ring shows while typing a reply.
    <InputGroup
      aria-label={label}
      className="h-auto flex-col items-stretch rounded-2xl border-border bg-background shadow-xs dark:bg-background"
      onKeyDown={onKeyDown}
    >
      <div className="flex items-start gap-2 px-4 pt-3 pb-1">
        <span className="mt-0.5 shrink-0 text-muted-foreground [&>svg]:size-4">{icon}</span>
        <div className="min-w-0 flex-1">{title}</div>
        {pager}
        {end}
      </div>
      {children}
      {reply ? (
        <div className="flex h-11 items-center border-t">
          <InputGroupInput
            className="px-4"
            aria-label={reply.placeholder}
            placeholder={reply.placeholder}
            value={reply.value}
            onChange={(event) => reply.onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
              event.preventDefault()
              if (reply.value.trim() && !reply.disabled) reply.onSend()
            }}
          />
          <InputGroupAddon align="inline-end">
            <SendButton disabled={reply.disabled || !reply.value.trim()} onClick={reply.onSend} />
          </InputGroupAddon>
        </div>
      ) : null}
    </InputGroup>
  )
}

function QuestionPanel({
  proposal,
  disabled,
  pager,
  onDecide,
}: {
  proposal: AgentProposalOut
  disabled: boolean
  pager: ReactNode
  onDecide: (decision: Decision) => void
}) {
  const [text, setText] = useState('')
  const { question, options, recommended } = questionOf(proposal)
  const answer = (value: string) =>
    onDecide({ proposalId: proposal.id, decision: 'answer', answer: value })

  // With the focus in the card (not in the text box), 1–4 pick an option.
  function pick(event: KeyboardEvent) {
    if (disabled || isEditable(event.target) || event.metaKey || event.ctrlKey || event.altKey) {
      return
    }
    const option = options[Number(event.key) - 1]
    if (!option) return
    event.preventDefault()
    answer(option.label)
  }

  return (
    <Panel
      label={question}
      icon={<MessageCircleQuestion />}
      title={<p className="font-medium">{question}</p>}
      pager={pager}
      end={
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                className="-my-1"
                aria-label={m.assistant_question_skip()}
                disabled={disabled}
                onClick={() => onDecide({ proposalId: proposal.id, decision: 'reject' })}
              />
            }
          >
            <X />
          </TooltipTrigger>
          <TooltipContent>{m.assistant_question_skip()}</TooltipContent>
        </Tooltip>
      }
      reply={{
        value: text,
        onChange: setText,
        placeholder: m.assistant_question_placeholder(),
        onSend: () => answer(text.trim()),
        disabled,
      }}
      onKeyDown={pick}
    >
      <div className="flex flex-col px-1.5 pb-1.5">
        {options.map((option, index) => (
          <Item
            key={option.label}
            size="xs"
            className="items-start rounded-xl text-left hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
            render={
              <button
                type="button"
                disabled={disabled}
                aria-label={[option.label, option.description].filter(Boolean).join(', ')}
              />
            }
            onClick={() => answer(option.label)}
          >
            <Kbd className="mt-0.5">{index + 1}</Kbd>
            <ItemContent className="gap-0.5">
              <ItemTitle>
                {option.label}
                {index === recommended ? (
                  <span className="text-xs font-normal text-primary">
                    {m.assistant_question_recommended()}
                  </span>
                ) : null}
              </ItemTitle>
              {option.description ? <ItemDescription>{option.description}</ItemDescription> : null}
            </ItemContent>
          </Item>
        ))}
      </div>
    </Panel>
  )
}

function ConfirmPanel({
  proposal,
  disabled,
  pager,
  others,
  onDecide,
  onDecideAll,
}: {
  proposal: AgentProposalOut
  disabled: boolean
  pager: ReactNode
  /** Changes waiting besides this one, which "approve all" also approves. */
  others: number
  onDecide: (decision: Decision) => void
  onDecideAll: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [remember, setRemember] = useState(false)
  const [text, setText] = useState('')
  const destructive = proposal.effect === 'destructive'
  const title = capabilityTitle(proposal.capability)
  const target = (proposal.preview as { target?: string } | null)?.target

  return (
    <Panel
      label={title}
      icon={destructive ? <Trash2 /> : <PencilLine />}
      title={
        <>
          <p className="flex flex-wrap items-center gap-2 font-medium">
            {title}
            {destructive ? (
              <Badge variant="destructive">{m.assistant_proposal_destructive()}</Badge>
            ) : null}
          </p>
          {target ? <p className="text-sm text-muted-foreground">{target}</p> : null}
        </>
      }
      pager={pager}
      reply={
        editing
          ? null
          : {
              value: text,
              onChange: setText,
              placeholder: m.assistant_proposal_instruct_placeholder(),
              onSend: () =>
                onDecide({ proposalId: proposal.id, decision: 'reject', reason: text.trim() }),
              disabled,
            }
      }
    >
      {editing ? (
        <div className="px-4 pt-2 pb-3">
          <EditForm
            proposal={proposal}
            disabled={disabled}
            onCancel={() => setEditing(false)}
            onSubmit={(args) =>
              onDecide({ proposalId: proposal.id, decision: 'edit', args, remember })
            }
          />
        </div>
      ) : (
        <>
          <div className="px-4 pt-1 pb-3 pl-10">
            <ProposalChanges proposal={proposal} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-3">
            {proposal.effect === 'write' ? (
              <Label className="text-xs font-normal text-muted-foreground">
                <Checkbox checked={remember} onCheckedChange={(checked) => setRemember(checked)} />
                {m.assistant_proposal_remember()}
              </Label>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              {others > 0 ? (
                <Button variant="ghost" size="sm" disabled={disabled} onClick={onDecideAll}>
                  {m.assistant_proposal_approve_all({ count: others + 1 })}
                </Button>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => onDecide({ proposalId: proposal.id, decision: 'reject' })}
              >
                {m.assistant_proposal_reject()}
              </Button>
              {editableFields(proposal).length > 0 ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={disabled}
                  onClick={() => setEditing(true)}
                >
                  {m.assistant_proposal_edit()}
                </Button>
              ) : null}
              <Button
                size="sm"
                variant={destructive ? 'destructive' : 'default'}
                disabled={disabled}
                onClick={() => onDecide({ proposalId: proposal.id, decision: 'approve', remember })}
              >
                {m.assistant_proposal_approve()}
              </Button>
            </div>
          </div>
        </>
      )}
    </Panel>
  )
}

/**
 * What Sem waits on, in the input's place (M12 §3.5, §6.1): its questions and the changes it
 * wants to make, one at a time. A question is answered by picking an option or typing; a change
 * is approved, edited or rejected, and typing tells Sem what to do instead. Once decided, a
 * question stays in the conversation as question and answer, a change as a step line.
 */
export function PendingDock({
  proposals,
  disabled,
  onDecide,
}: {
  /** The waiting cards, oldest first. */
  proposals: readonly AgentProposalOut[]
  disabled: boolean
  onDecide: (decisions: Decision[]) => void
}) {
  const [chosen, setChosen] = useState<string | null>(null)
  const found = proposals.findIndex((p) => p.id === chosen)
  const index = found < 0 ? 0 : found
  const current = proposals[index]
  if (!current) return null
  const pager = (
    <Pager
      index={index}
      count={proposals.length}
      onMove={(to) => setChosen(proposals[to]?.id ?? null)}
    />
  )
  if (current.capability === ASK_USER) {
    return (
      <QuestionPanel
        key={current.id}
        proposal={current}
        disabled={disabled}
        pager={pager}
        onDecide={(decision) => onDecide([decision])}
      />
    )
  }
  const changes = proposals.filter((p) => p.capability !== ASK_USER)
  return (
    <ConfirmPanel
      key={current.id}
      proposal={current}
      disabled={disabled}
      pager={pager}
      others={changes.length - 1}
      onDecide={(decision) => onDecide([decision])}
      onDecideAll={() =>
        onDecide(changes.map((p) => ({ proposalId: p.id, decision: 'approve' as const })))
      }
    />
  )
}
