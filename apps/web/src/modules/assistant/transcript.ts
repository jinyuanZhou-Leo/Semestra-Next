import type { AgentMessageOut, AgentProposalOut, AgentSessionDetail } from '@semestra/api-client'
import type { AgentEvent, Citation } from './stream'

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
}

export type AttachmentRef = { id: string; name: string; kind: 'image' | 'file' }

export type ViewItem =
  | {
      kind: 'user'
      id: string
      text: string
      skill: Record<string, string> | null
      attachments: AttachmentRef[]
    }
  | {
      kind: 'assistant'
      id: string
      text: string
      steps: Step[]
      proposals: AgentProposalOut[]
    }

const str = (value: unknown): string => (typeof value === 'string' ? value : '')

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
  const items: ViewItem[] = []
  for (const message of detail.messages) {
    if (message.role === 'user') {
      const content = message.content
      if (content.every((b) => b.type === 'note')) continue
      items.push({
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
      })
    } else if (message.role === 'assistant') {
      const calls = message.content.filter((b) => b.type === 'tool_call')
      items.push({
        kind: 'assistant',
        id: message.id,
        text: message.content
          .filter((b) => b.type === 'text')
          .map((b) => str(b.text))
          .join(''),
        steps: calls.map((call) => {
          const callId = str(call.id)
          const result = results.get(callId)
          const proposal = proposalByCall.get(callId)
          let status: StepStatus = generating ? 'running' : 'error'
          if (result) status = result.is_error ? 'error' : 'done'
          if (proposal?.status === 'pending') status = 'waiting'
          else if (proposal?.status === 'rejected') status = 'rejected'
          else if (proposal?.status === 'expired') status = 'expired'
          return {
            callId,
            name: capabilityName(str(call.name)),
            args: (call.args as Record<string, unknown> | undefined) ?? {},
            status,
            errorCode: result ? ((result.error_code as string | null) ?? null) : null,
          }
        }),
        proposals: detail.proposals.filter((p) => p.message_id === message.id),
      })
    }
  }
  return items
}

/** Every file quoted in the conversation, by id. */
export function citationsOf(detail: AgentSessionDetail): Map<string, Citation> {
  const out = new Map<string, Citation>()
  for (const message of detail.messages) {
    for (const block of message.content) {
      if (block.type === 'citation' && typeof block.id === 'string') {
        out.set(block.id, block as Citation)
      }
    }
  }
  return out
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

/** Applies one streamed event to the cached transcript (the server copy is re-read after). */
export function applyEvent(detail: AgentSessionDetail, event: AgentEvent): AgentSessionDetail {
  switch (event.event) {
    case 'message_start':
      if (detail.messages.some((m) => m.id === event.data.message_id)) return detail
      return {
        ...detail,
        messages: [...detail.messages, newMessage(event.data.message_id, 'assistant', [])],
      }
    case 'text_delta':
      return updateMessage(detail, event.data.message_id, (content) => {
        const last = content.at(-1)
        if (last?.type === 'text') {
          return [...content.slice(0, -1), { ...last, text: str(last.text) + event.data.text }]
        }
        return [...content, { type: 'text', text: event.data.text }]
      })
    case 'tool_call':
      return updateMessage(detail, event.data.message_id, (content) => [
        ...content,
        { type: 'tool_call', id: event.data.call_id, name: event.data.name, args: event.data.args },
      ])
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
    default:
      return detail
  }
}

/** The last answer can be regenerated unless it already changed data. */
export function canRegenerate(detail: AgentSessionDetail, items: ViewItem[]): string | null {
  const last = items.at(-1)
  if (last?.kind !== 'assistant') return null
  const lastUser = items.findLastIndex((item) => item.kind === 'user')
  const turn = items.slice(lastUser + 1).map((item) => item.id)
  const changed = detail.proposals.some(
    (p) => turn.includes(p.message_id) && (p.status === 'executed' || p.status === 'failed'),
  )
  return changed ? null : last.id
}
