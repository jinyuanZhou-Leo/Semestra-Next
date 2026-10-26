import type { AgentMessageOut, AgentProposalOut, AgentSessionDetail } from '@semestra/api-client'
import type { AgentEvent, Citation, PauseReason, RememberedMemory, StepDisplay } from './stream'

type Block = Record<string, unknown>

/** Tool names travel as `module__thing__verb`; the UI shows capability names. */
export function capabilityName(tool: string): string {
  return tool.replaceAll('__', '.')
}

export type StepStatus = 'running' | 'done' | 'error' | 'waiting' | 'rejected' | 'expired'

/** One tool call of an answer, shown as a collapsible "step" line (M12 §6.1). */
export type Step = {
  callId: string
  name: string
  args: Record<string, unknown>
  status: StepStatus
  errorCode: string | null
  /** The confirmation card of a write, when it needed one. */
  proposal: AgentProposalOut | null
  /** What a memory call saved. */
  memory: RememberedMemory | null
  /** Names and counts for its line, once it has run. */
  display: StepDisplay | null
  /** It changed the user's data. */
  changed: boolean
}

export type AttachmentRef = { id: string; name: string; kind: 'image' | 'file' }

/** What the model did before it answered, in order: shown folded in the thinking block. */
export type ProcessEntry = {
  /** The model message it came from: one step of the model. */ message: string
} & (
  | { kind: 'reasoning'; key: string; text: string }
  | { kind: 'text'; key: string; text: string }
  | { kind: 'step'; key: string; step: Step }
)

export type ViewItem =
  | {
      kind: 'user'
      id: string
      text: string
      skill: Record<string, string> | null
      attachments: AttachmentRef[]
    }
  | {
      /** One answer: every assistant message between two user messages. */
      kind: 'assistant'
      /** The first message of the answer (a stable key while more messages stream in). */
      id: string
      /** The last message; regenerating any message of the last answer replaces all of it. */
      lastId: string
      process: ProcessEntry[]
      /** The reply itself: the text of the last message once it no longer calls tools. */
      answer: string
      steps: Step[]
      proposals: AgentProposalOut[]
      /** How long the model worked before answering; null for answers stored without it. */
      thinkingMs: number | null
    }

type AssistantItem = Extract<ViewItem, { kind: 'assistant' }>

const str = (value: unknown): string => (typeof value === 'string' ? value : '')

function textOf(message: AgentMessageOut): string {
  return message.content
    .filter((b) => b.type === 'text')
    .map((b) => str(b.text))
    .join('')
}

function timingOf(message: AgentMessageOut): number | null {
  const ms = message.content.find((b) => b.type === 'timing')?.thinking_ms
  return typeof ms === 'number' ? ms : null
}

/**
 * Items already built, by their first message. The query cache shares unchanged objects between
 * updates, so an item whose messages, results and cards are the same objects is reused as is:
 * while an answer streams, only the last item is new and the earlier ones skip rendering.
 */
const built = new WeakMap<AgentMessageOut, { deps: unknown[]; item: ViewItem }>()

function reuse(key: AgentMessageOut, deps: unknown[], make: () => ViewItem): ViewItem {
  const hit = built.get(key)
  if (hit && hit.deps.length === deps.length && hit.deps.every((d, i) => d === deps[i])) {
    return hit.item
  }
  const item = make()
  built.set(key, { deps, item })
  return item
}

/** The stored transcript as the conversation shows it: tool messages fold into their steps. */
export function buildItems(detail: AgentSessionDetail, generating = false): ViewItem[] {
  const results = new Map<string, Block>()
  for (const message of detail.messages) {
    if (message.role !== 'tool') continue
    for (const block of message.content) {
      if (block.type === 'tool_result') results.set(str(block.call_id), block)
    }
  }
  const proposalByCall = new Map(detail.proposals.map((p) => [p.call_id, p]))
  const stepOf = (call: Block): Step => {
    const callId = str(call.id)
    const result = results.get(callId)
    const proposal = proposalByCall.get(callId)
    let status: StepStatus = generating ? 'running' : 'error'
    if (result) status = result.is_error ? 'error' : 'done'
    // A card decided while another still waits, or after the conversation moved on, has no
    // result row: what it did is on the card.
    else if (proposal?.status === 'executed') status = 'done'
    else if (proposal?.status === 'failed') status = 'error'
    if (proposal?.status === 'pending') status = 'waiting'
    else if (proposal?.status === 'rejected') status = 'rejected'
    else if (proposal?.status === 'expired') status = 'expired'
    const ranCard = !result && (proposal?.status === 'executed' || proposal?.status === 'failed')
    return {
      callId,
      name: capabilityName(str(call.name)),
      args: (call.args as Record<string, unknown> | undefined) ?? {},
      status,
      errorCode: result
        ? ((result.error_code as string | null) ?? null)
        : ranCard
          ? (proposal?.error_code ?? null)
          : null,
      proposal: proposal ?? null,
      memory: (result?.memory as RememberedMemory | undefined) ?? null,
      display:
        (result?.display as StepDisplay | undefined) ??
        (proposal?.display as StepDisplay | null | undefined) ??
        null,
      changed: result ? result.changed === true : proposal?.status === 'executed',
    }
  }

  const items: ViewItem[] = []
  let turn: AgentMessageOut[] = []
  const closeTurn = () => {
    const messages = turn
    turn = []
    if (messages.length === 0) return
    const calls = messages.flatMap((m) => m.content.filter((b) => b.type === 'tool_call'))
    const ids = new Set(messages.map((m) => m.id))
    const deps = [
      ...messages,
      ...calls.flatMap((c) => [results.get(str(c.id)), proposalByCall.get(str(c.id))]),
      ...detail.proposals.filter((p) => ids.has(p.message_id)),
      // A call without a result is running or failed depending on it.
      calls.length > 0 && generating,
    ]
    items.push(
      reuse(messages[0] as AgentMessageOut, deps, () =>
        assistantItem(messages, detail.proposals, stepOf),
      ),
    )
  }
  for (const message of detail.messages) {
    if (message.role === 'user') {
      const content = message.content
      if (content.every((b) => b.type === 'note')) continue
      closeTurn()
      items.push(reuse(message, [message], () => userItem(message)))
    } else if (message.role === 'assistant') {
      turn.push(message)
    }
  }
  closeTurn()
  return items
}

function userItem(message: AgentMessageOut): ViewItem {
  const content = message.content
  return {
    kind: 'user',
    id: message.id,
    text: content
      .filter((b) => b.type === 'text')
      .map((b) => str(b.text))
      .join('\n'),
    skill: (content.find((b) => b.type === 'skill')?.title as Record<string, string>) ?? null,
    attachments: content
      .filter((b) => b.type === 'image_ref' || b.type === 'file_ref')
      .map((b) => ({
        id: str(b.attachment_id),
        name: str(b.name),
        kind: b.type === 'image_ref' ? 'image' : 'file',
      })),
  }
}

function assistantItem(
  messages: AgentMessageOut[],
  proposals: readonly AgentProposalOut[],
  stepOf: (call: Block) => Step,
): AssistantItem {
  const last = messages.at(-1) as AgentMessageOut
  const lastCalls = last.content.some((b) => b.type === 'tool_call')
  const process: ProcessEntry[] = []
  const steps: Step[] = []
  let thinkingMs: number | null = null
  for (const message of messages) {
    const calls = message.content.filter((b) => b.type === 'tool_call')
    message.content.forEach((block, index) => {
      if (block.type === 'reasoning' && str(block.text)) {
        process.push({
          kind: 'reasoning',
          key: `${message.id}-r${index}`,
          text: str(block.text),
          message: message.id,
        })
      }
    })
    const text = textOf(message)
    // Words said before calling tools ("Let me check your grades") belong to the process.
    if (text && (message !== last || lastCalls)) {
      process.push({ kind: 'text', key: `${message.id}-t`, text, message: message.id })
    }
    for (const call of calls) {
      const step = stepOf(call)
      steps.push(step)
      process.push({ kind: 'step', key: step.callId, step, message: message.id })
    }
    const ms = timingOf(message)
    if (ms !== null) thinkingMs = (thinkingMs ?? 0) + ms
  }
  const ids = new Set(messages.map((m) => m.id))
  return {
    kind: 'assistant',
    id: (messages[0] as AgentMessageOut).id,
    lastId: last.id,
    process,
    answer: lastCalls ? '' : textOf(last),
    steps,
    proposals: proposals.filter((p) => ids.has(p.message_id)),
    thinkingMs,
  }
}

let lastCitations = new Map<string, Citation>()

/** Every file quoted in the conversation, by id; the same Map while they stay the same. */
export function citationsOf(detail: AgentSessionDetail): Map<string, Citation> {
  const out = new Map<string, Citation>()
  for (const message of detail.messages) {
    for (const block of message.content) {
      if (block.type === 'citation' && typeof block.id === 'string') {
        out.set(block.id, block as Citation)
      }
    }
  }
  const same =
    out.size === lastCitations.size && [...out].every(([id, c]) => lastCitations.get(id) === c)
  if (!same) lastCitations = out
  return lastCitations
}

function now(): string {
  return new Date().toISOString()
}

function newMessage(id: string, role: AgentMessageOut['role'], content: Block[]): AgentMessageOut {
  return {
    id,
    role,
    content,
    model: null,
    input_tokens: null,
    output_tokens: null,
    created_at: now(),
  }
}

function updateMessage(
  detail: AgentSessionDetail,
  id: string,
  change: (content: Block[]) => Block[],
): AgentSessionDetail {
  if (!detail.messages.some((m) => m.id === id)) {
    // The transcript was re-read after the answer began: keep streaming into a new copy.
    return { ...detail, messages: [...detail.messages, newMessage(id, 'assistant', change([]))] }
  }
  return {
    ...detail,
    messages: detail.messages.map((m) => (m.id === id ? { ...m, content: change(m.content) } : m)),
  }
}

/** The user's message as sent, shown before the server has stored it. */
export function withUserMessage(
  detail: AgentSessionDetail,
  id: string,
  blocks: Block[],
): AgentSessionDetail {
  return { ...detail, messages: [...detail.messages, newMessage(id, 'user', blocks)] }
}

/** A message edited by the user, before the server answers again: later messages are gone. */
export function withEditedMessage(
  detail: AgentSessionDetail,
  id: string,
  text: string,
): AgentSessionDetail {
  const index = detail.messages.findIndex((m) => m.id === id)
  if (index < 0) return detail
  const kept = detail.messages.slice(0, index + 1)
  const message = kept[index]
  if (!message) return detail
  const others = message.content.filter((b) => b.type !== 'text')
  const skill = others.findIndex((b) => b.type === 'skill')
  const content = text ? others.toSpliced(skill + 1, 0, { type: 'text', text }) : others
  const ids = new Set(kept.map((m) => m.id))
  return {
    ...detail,
    messages: kept.with(index, { ...message, content }),
    proposals: detail.proposals.filter((p) => ids.has(p.message_id)),
  }
}

/** Adds streamed text to the last block of that type, or starts one. */
function appendText(content: Block[], type: 'text' | 'reasoning', text: string): Block[] {
  const last = content.at(-1)
  if (last?.type === type) {
    return [...content.slice(0, -1), { ...last, text: str(last.text) + text }]
  }
  return [...content, { type, text }]
}

/** Records how long the message has been worked on; `again` replaces an earlier stop. */
function stopTimer(content: Block[], again: boolean): Block[] {
  return content.map((block) => {
    if (block.type !== 'timing' || typeof block.started !== 'number') return block
    if (typeof block.thinking_ms === 'number' && !again) return block
    return { ...block, thinking_ms: Date.now() - block.started }
  })
}

/** Applies one streamed event to the cached transcript (the server copy is re-read after). */
/**
 * Following a turn from its start (a reload, another tab): what came after the row stored before
 * the turn is dropped, as the replayed events rebuild it. Unchanged when that row is not here.
 */
export function restartFrom(detail: AgentSessionDetail, after: string | null): AgentSessionDetail {
  const at = after === null ? -1 : detail.messages.findIndex((m) => m.id === after)
  if (after !== null && at < 0) return detail
  return { ...detail, messages: detail.messages.slice(0, at + 1) }
}

export function applyEvent(detail: AgentSessionDetail, event: AgentEvent): AgentSessionDetail {
  switch (event.event) {
    case 'message_start':
      if (detail.messages.some((m) => m.id === event.data.message_id)) return detail
      return {
        ...detail,
        messages: [
          ...detail.messages,
          // Times the model's work like the server does (`thinking_ms`) until it is re-read.
          newMessage(event.data.message_id, 'assistant', [{ type: 'timing', started: Date.now() }]),
        ],
      }
    case 'reasoning_delta':
      return updateMessage(detail, event.data.message_id, (content) =>
        appendText(content, 'reasoning', event.data.text),
      )
    case 'text_delta':
      return updateMessage(detail, event.data.message_id, (content) =>
        appendText(stopTimer(content, false), 'text', event.data.text),
      )
    case 'tool_call':
      return updateMessage(detail, event.data.message_id, (content) => [
        // A step that calls tools worked until its end, words before the call included.
        ...stopTimer(content, true),
        { type: 'tool_call', id: event.data.call_id, name: event.data.name, args: event.data.args },
      ])
    case 'message_end':
      if (!detail.messages.some((m) => m.id === event.data.message_id)) return detail
      return updateMessage(detail, event.data.message_id, (content) => stopTimer(content, false))
    case 'tool_result':
      return {
        ...detail,
        messages: [
          ...detail.messages,
          newMessage(`result-${event.data.call_id}-${detail.messages.length}`, 'tool', [
            {
              type: 'tool_result',
              call_id: event.data.call_id,
              name: event.data.name,
              is_error: !event.data.ok,
              error_code: event.data.error_code,
              changed: event.data.changed ?? false,
              ...(event.data.memory ? { memory: event.data.memory } : {}),
              ...(event.data.display ? { display: event.data.display } : {}),
            },
          ]),
        ],
      }
    case 'citation': {
      const last = detail.messages.at(-1)
      if (!last) return detail
      return updateMessage(detail, last.id, (content) => [
        ...content,
        { ...event.data, type: 'citation' },
      ])
    }
    case 'proposal': {
      const others = detail.proposals.filter((p) => p.id !== event.data.id)
      return { ...detail, proposals: [...others, event.data] }
    }
    case 'title':
      return { ...detail, session: { ...detail.session, title: event.data.title } }
    case 'paused':
      return updateMessage(detail, event.data.message_id, (content) => [
        ...content,
        { type: 'paused', reason: event.data.reason },
      ])
    default:
      return detail
  }
}

/** Why the conversation's last answer paused, when the turn can be continued. */
export function pausedReason(detail: AgentSessionDetail): PauseReason | null {
  const block = detail.messages.at(-1)?.content.find((b) => b.type === 'paused')
  return block?.reason === 'loop' || block?.reason === 'tool_limit' ? block.reason : null
}

/** The index of the user's last own message (notes Semestra added are not theirs). */
export function lastTypedUser(messages: AgentSessionDetail['messages']): number {
  return messages.findLastIndex(
    (m) => m.role === 'user' && m.content.some((b) => b.type !== 'note'),
  )
}
