import type { AgentProposalOut, MemoryOut } from '@semestra/api-client'
import { csrfHeaders, toApiError } from '@/app/api'
import { apiUrl } from '@/lib/api-extras'

/** What the server tells the chat about one tool call: names behind its ids, and counts. */
export type StepDisplay = {
  /** What it was about, by name (a term, a course code, a file). */
  target?: string[]
  /** How many items it read. */
  count?: number
  changed?: number
  created?: number
  updated?: number
  failed?: number
  /** An import's accepted items per type, and its open issues. */
  accepted?: Record<string, number>
  issues?: number
}

/** A file quoted by a tool result (M07); `[[cite:<id>]]` in the answer points at it. */
export type Citation = {
  id: string
  title?: string
  name?: string
  snippet?: string
  text?: string
  url?: string
  [key: string]: unknown
}

/** Why a turn paused: the tool-call limit of one message, or the same call over and over. */
export type PauseReason = 'tool_limit' | 'loop'

/** The server-sent events of a turn (M12 §4). */
export type RememberedMemory = {
  id: string
  name?: string
  /** The memory's line as the call left it. */
  description?: string
  /** The same, on results saved before memories had names. */
  content?: string
  /** Missing on results saved before forgetting was shown. */
  action?: 'remembered' | 'updated' | 'forgot'
  /** For `updated`: what the call replaced, which its undo puts back. */
  previous?: { name: string; type: MemoryOut['type']; description: string; body: string }
}

export type AgentEvent =
  | { event: 'message_start'; data: { message_id: string } }
  | { event: 'text_delta'; data: { message_id: string; text: string } }
  | { event: 'reasoning_delta'; data: { message_id: string; text: string } }
  | {
      event: 'message_end'
      data: { message_id: string; stopped?: boolean; input_tokens?: number; output_tokens?: number }
    }
  | {
      event: 'tool_call'
      data: { message_id: string; call_id: string; name: string; args: Record<string, unknown> }
    }
  | {
      event: 'tool_result'
      data: {
        message_id: string
        call_id: string
        name: string
        ok: boolean
        error_code: string | null
        changed?: boolean
        /** What a memory call saved, updated or forgot: the chat offers to undo it. */
        memory?: RememberedMemory
        /** Names and counts for the step's line (`agent/display.py`). */
        display?: StepDisplay
      }
    }
  | { event: 'citation'; data: Citation }
  | { event: 'proposal'; data: AgentProposalOut }
  | { event: 'title'; data: { title: string } }
  /** The turn stopped at a limit (M12 §3.2); `continue` picks it up again. */
  | { event: 'paused'; data: { message_id: string; reason: PauseReason } }
  | { event: 'error'; data: { code: string; params: Record<string, unknown> } }

/** Splits an SSE body into events; `rest` is an incomplete block to prepend to the next chunk. */
export function parseSse(buffer: string): { events: AgentEvent[]; rest: string } {
  const blocks = buffer.split(/\r?\n\r?\n/)
  const rest = blocks.pop() ?? ''
  const events: AgentEvent[] = []
  for (const block of blocks) {
    let name = 'message'
    const data: string[] = []
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) name = line.slice(6).trim()
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
    }
    if (data.length === 0) continue // a keep-alive comment
    try {
      events.push({ event: name, data: JSON.parse(data.join('\n')) } as AgentEvent)
    } catch {
      // A malformed event is skipped; the transcript is re-read when the turn ends.
    }
  }
  return { events, rest }
}

/**
 * POSTs to one of the streaming endpoints (send, decide, regenerate) and calls `onEvent` for
 * every event until the turn ends. Errors before the stream starts are thrown as `ApiError`.
 */
export async function streamAgent(
  path: string,
  body: unknown,
  onEvent: (event: AgentEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(apiUrl(path), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...csrfHeaders() },
    body: JSON.stringify(body),
    signal,
  })
  if (!response.ok || !response.body) {
    const json: unknown = await response.json().catch(() => undefined)
    throw toApiError(json, response.status)
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    const parsed = parseSse(buffer + value)
    buffer = parsed.rest
    for (const event of parsed.events) onEvent(event)
  }
  for (const event of parseSse(`${buffer}\n\n`).events) onEvent(event)
}
