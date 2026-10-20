import type {
  AgentMessageOut,
  AgentScope,
  AgentProposalOut,
  AgentSessionDetail,
  AgentSessionOut,
} from '@semestra/api-client'
import { QueryClientProvider } from '@tanstack/react-query'
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useNavigate,
} from '@tanstack/react-router'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { useState } from 'react'
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'vitest'
import { academicsHandlers, defaultWorld } from '@/modules/academics/test-data'
import { API, newQueryClient, renderWithRouter, server } from '@/test-utils'
import { SidebarProvider } from '@/ui/sidebar'
import { AssistantPage } from './components/AssistantPage'
import { Conversation } from './components/Conversation'
import { Remembered } from './components/Remembered'
import { groupSessions } from './components/SessionList'
import { ApprovalsSection } from './settings/ApprovalsSection'
import { mcpConfig } from './settings/McpSection'
import { usePageScope } from './scope'
import { parseSse } from './stream'
import { applyEvent, buildItems, canRegenerate, withEditedMessage } from './transcript'

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const NOW = '2026-10-19T12:00:00Z'

function session(overrides: Partial<AgentSessionOut> = {}): AgentSessionOut {
  return {
    id: 's1',
    title: null,
    program_id: 'p1',
    scope: { program_id: 'p1', term_id: null, course_id: null },
    pinned: false,
    temporary: false,
    created_at: NOW,
    updated_at: NOW,
    archived_at: null,
    ...overrides,
  }
}

function proposal(overrides: Partial<AgentProposalOut> = {}): AgentProposalOut {
  return {
    id: 'pr1',
    session_id: 's1',
    message_id: 'a1',
    call_id: 'call1',
    capability: 'grading.assessment.update',
    effect: 'write',
    args: { assessment_id: 'as1', score_percentage: 90 },
    input_schema: {
      properties: {
        assessment_id: { type: 'string', title: 'Assessment Id' },
        score_percentage: { anyOf: [{ type: 'number' }, { type: 'null' }], title: 'Score' },
      },
    },
    preview: {
      target: 'Lab 3 · APS105H1 Computer Fundamentals',
      changes: [{ field: 'score_percentage', before: null, after: 90 }],
      link: { to: '/p/p1/c/c1/grades', page: 'grades' },
    },
    status: 'pending',
    result: null,
    error_code: null,
    created_at: NOW,
    decided_at: null,
    executed_at: null,
    ...overrides,
  }
}

function sse(events: [string, unknown][]): Response {
  const body = events.map(
    ([name, data]) => `event: ${name}\r\ndata: ${JSON.stringify(data)}\r\n\r\n`,
  )
  return new Response(body.join(''), { headers: { 'Content-Type': 'text/event-stream' } })
}

type Server = {
  detail: AgentSessionDetail
  sent: { path: string; body: Record<string, unknown> }[]
  /** What the next streaming request answers with; it also updates `detail`. */
  reply: (path: string, body: Record<string, unknown>) => Response
}

let srv: Server

function msg(id: string, role: AgentMessageOut['role'], content: Record<string, unknown>[]) {
  return {
    id,
    role,
    content,
    model: null,
    input_tokens: null,
    output_tokens: null,
    created_at: NOW,
  }
}

let assistantSettings: Record<string, unknown> = {}

beforeEach(() => {
  assistantSettings = {}
  srv = {
    detail: { session: session(), messages: [], proposals: [], attachments: [], generating: false },
    sent: [],
    reply: () => sse([]),
  }
  const world = defaultWorld()
  server.use(
    ...academicsHandlers(world),
    http.get(`${API}/ai/status`, () =>
      HttpResponse.json({
        items: [
          {
            purpose: 'chat',
            available: true,
            source: 'default',
            provider_id: 'pv1',
            provider_kind: 'anthropic',
            provider_name: 'Anthropic',
            model: 'm',
          },
        ],
      }),
    ),
    http.get(`${API}/agent/skills`, () =>
      HttpResponse.json({
        items: [
          {
            name: 'record-grades',
            title: { en: 'Record grades', 'zh-CN': '录入成绩' },
            command: '/grade',
            description: 'Record scores',
            module: 'grading',
          },
        ],
      }),
    ),
    http.post(`${API}/agent/sessions`, () => HttpResponse.json(srv.detail.session)),
    http.get(`${API}/agent/sessions`, () => HttpResponse.json({ items: [srv.detail.session] })),
    http.get(`${API}/agent/sessions/:id`, () => HttpResponse.json(srv.detail)),
    http.get(`${API}/settings/assistant`, () =>
      HttpResponse.json({ namespace: 'assistant', values: assistantSettings, inherited: {} }),
    ),
    http.post(`${API}/agent/sessions/s1/*`, async ({ request }) => {
      const path = new URL(request.url).pathname
      const body = (await request.json()) as Record<string, unknown>
      srv.sent.push({ path, body })
      return srv.reply(path, body)
    }),
  )
})

/** The input, once the AI status has loaded and it accepts text. */
async function messageInput() {
  const input = await screen.findByRole('textbox', { name: 'Message' })
  await waitFor(() => expect(input).toBeEnabled())
  return input
}

/** A new conversation that, like the panel, shows the session once it is created. */
function Host({
  pageScope,
  onCreated,
}: {
  pageScope: AgentScope
  onCreated: (id: string) => void
}) {
  const [id, setId] = useState<string | null>(null)
  return (
    <Conversation
      sessionId={id}
      pageScope={pageScope}
      onCreated={(created) => {
        onCreated(created)
        setId(created)
      }}
    />
  )
}

function renderConversation(
  pageScope: AgentScope = { program_id: 'p1', term_id: 't2', course_id: 'c1' },
) {
  let created: string | null = null
  const view = renderWithRouter(
    <Host
      pageScope={pageScope}
      onCreated={(id) => {
        created = id
      }}
    />,
  )
  return { ...view, created: () => created }
}

test('parses server-sent events across chunks and skips keep-alives', () => {
  const first = parseSse(
    'event: text_delta\r\ndata: {"message_id":"a","text":"Hi"}\r\n\r\n: ping\r\n\r\nevent: tit',
  )
  expect(first.events).toEqual([{ event: 'text_delta', data: { message_id: 'a', text: 'Hi' } }])
  const second = parseSse(`${first.rest}le\ndata: {"title":"Lab"}\n\n`)
  expect(second.events).toEqual([{ event: 'title', data: { title: 'Lab' } }])
})

test('streamed events build the answer, its steps and the confirmation card', () => {
  let detail: AgentSessionDetail = {
    session: session(),
    messages: [msg('u1', 'user', [{ type: 'text', text: 'I got 18/20 on Lab 3' }])],
    proposals: [],
    attachments: [],
    generating: true,
  }
  for (const event of [
    { event: 'message_start', data: { message_id: 'a1' } },
    { event: 'text_delta', data: { message_id: 'a1', text: 'Found ' } },
    { event: 'text_delta', data: { message_id: 'a1', text: 'it.' } },
    {
      event: 'tool_call',
      data: { message_id: 'a1', call_id: 'c0', name: 'grading.assessment.list', args: {} },
    },
    {
      event: 'tool_call',
      data: { message_id: 'a1', call_id: 'call1', name: 'grading.assessment.update', args: {} },
    },
    {
      event: 'tool_result',
      data: {
        message_id: 'a1',
        call_id: 'c0',
        name: 'grading.assessment.list',
        ok: true,
        error_code: null,
      },
    },
    { event: 'proposal', data: proposal() },
    { event: 'title', data: { title: 'Lab 3 score' } },
  ] as const) {
    detail = applyEvent(detail, event)
  }
  const items = buildItems(detail)
  expect(items.map((i) => i.kind)).toEqual(['user', 'assistant'])
  const answer = items[1]
  // Words said before calling tools are part of the thinking, not the reply.
  expect(answer?.kind === 'assistant' && answer.answer).toBe('')
  expect(answer?.kind === 'assistant' && answer.process.map((e) => e.kind)).toEqual([
    'text',
    'step',
    'step',
  ])
  expect(answer?.kind === 'assistant' && answer.steps.map((s) => s.status)).toEqual([
    'done',
    'waiting',
  ])
  expect(answer?.kind === 'assistant' && answer.proposals).toHaveLength(1)
  expect(detail.session.title).toBe('Lab 3 score')
})

test('the messages of one answer form one item that sums how long the model worked', () => {
  const detail: AgentSessionDetail = {
    session: session(),
    messages: [
      msg('u1', 'user', [{ type: 'text', text: 'When is Lab 3 due?' }]),
      msg('a1', 'assistant', [
        { type: 'reasoning', text: 'Look it up.' },
        { type: 'text', text: 'Let me check.' },
        { type: 'tool_call', id: 'c1', name: 'grading__assessment__find', args: {} },
        { type: 'timing', thinking_ms: 2400 },
      ]),
      msg('t1', 'tool', [{ type: 'tool_result', call_id: 'c1', name: 'x', is_error: false }]),
      msg('a2', 'assistant', [
        { type: 'reasoning', text: 'Friday.' },
        { type: 'text', text: 'Lab 3 is due Friday.' },
        { type: 'timing', thinking_ms: 600 },
      ]),
    ],
    proposals: [],
    attachments: [],
    generating: false,
  }
  const [, answer] = buildItems(detail)
  expect(answer).toMatchObject({
    kind: 'assistant',
    id: 'a1',
    lastId: 'a2',
    answer: 'Lab 3 is due Friday.',
    thinkingMs: 3000,
  })
  expect(answer?.kind === 'assistant' && answer.process.map((e) => e.kind)).toEqual([
    'reasoning',
    'text',
    'step',
    'reasoning',
  ])
})

test('an answer keeps streaming when the transcript is re-read mid-answer', () => {
  // A refetch returns the server copy, which has no row for the answer being written yet.
  const stored: AgentSessionDetail = {
    session: session(),
    messages: [msg('u1', 'user', [{ type: 'text', text: 'Hi' }])],
    proposals: [],
    attachments: [],
    generating: true,
  }
  const detail = applyEvent(stored, {
    event: 'text_delta',
    data: { message_id: 'a1', text: 'Hello' },
  })
  const [, answer] = buildItems(detail)
  expect(answer?.kind === 'assistant' && answer.answer).toBe('Hello')
  expect(
    applyEvent(stored, { event: 'message_end', data: { message_id: 'a1' } }).messages,
  ).toHaveLength(1)
})

test('an answer whose tools changed data cannot be regenerated', () => {
  const turn = (changed: boolean): AgentSessionDetail => {
    let detail: AgentSessionDetail = {
      session: session(),
      messages: [msg('u1', 'user', [{ type: 'text', text: 'make it 70' }])],
      proposals: [],
      attachments: [],
      generating: false,
    }
    for (const event of [
      { event: 'message_start', data: { message_id: 'a1' } },
      {
        event: 'tool_result',
        data: { message_id: 'a1', call_id: 'c1', name: 'x', ok: true, error_code: null, changed },
      },
      { event: 'message_start', data: { message_id: 'a2' } },
      { event: 'text_delta', data: { message_id: 'a2', text: 'Done.' } },
    ] as const) {
      detail = applyEvent(detail, event)
    }
    return detail
  }
  const read = turn(false)
  expect(canRegenerate(read, buildItems(read))).toBe('a1')
  const wrote = turn(true)
  expect(canRegenerate(wrote, buildItems(wrote))).toBeNull()
})

test('a question streams in as Markdown', async () => {
  srv.reply = () => {
    srv.detail.messages = [
      msg('u1', 'user', [{ type: 'text', text: 'Hello' }]),
      msg('a1', 'assistant', [{ type: 'text', text: 'Hi **there**' }]),
    ]
    return sse([
      ['message_start', { message_id: 'a1' }],
      ['text_delta', { message_id: 'a1', text: 'Hi **the' }],
      ['text_delta', { message_id: 'a1', text: 're**' }],
      ['message_end', { message_id: 'a1', input_tokens: 1, output_tokens: 1 }],
    ])
  }
  const view = renderConversation()
  const input = await messageInput()
  await userEvent.type(input, 'Hello{Enter}')
  expect(await screen.findByText('there', { selector: 'strong' })).toBeInTheDocument()
  expect(view.created()).toBe('s1')
  expect(srv.sent[0]).toMatchObject({
    path: '/agent/sessions/s1/messages',
    body: { text: 'Hello' },
  })
  expect(input).toHaveValue('')
})

test('a write waits on a card: approving sends the decision and shows the result', async () => {
  srv.reply = (path) => {
    if (path.endsWith('/messages')) {
      srv.detail.messages = [
        msg('u1', 'user', [{ type: 'text', text: 'I got 18/20 on Lab 3' }]),
        msg('a1', 'assistant', [
          { type: 'tool_call', id: 'call1', name: 'grading__assessment__update', args: {} },
        ]),
      ]
      srv.detail.proposals = [proposal()]
      return sse([
        ['message_start', { message_id: 'a1' }],
        [
          'tool_call',
          { message_id: 'a1', call_id: 'call1', name: 'grading.assessment.update', args: {} },
        ],
        ['proposal', proposal()],
      ])
    }
    const done = proposal({ status: 'executed', decided_at: NOW, executed_at: NOW })
    srv.detail.proposals = [done]
    srv.detail.messages.push(
      msg('t1', 'tool', [
        {
          type: 'tool_result',
          call_id: 'call1',
          name: 'grading__assessment__update',
          is_error: false,
        },
      ]),
      msg('a2', 'assistant', [{ type: 'text', text: 'Recorded 90%.' }]),
    )
    return sse([
      [
        'tool_result',
        {
          message_id: 'a1',
          call_id: 'call1',
          name: 'grading.assessment.update',
          ok: true,
          error_code: null,
        },
      ],
      ['proposal', done],
      ['message_start', { message_id: 'a2' }],
      ['text_delta', { message_id: 'a2', text: 'Recorded 90%.' }],
      ['message_end', { message_id: 'a2' }],
    ])
  }
  renderConversation()
  await userEvent.type(await messageInput(), 'I got 18/20 on Lab 3{Enter}')
  const card = await screen.findByLabelText('Update an assessment')
  expect(within(card).getByText('Lab 3 · APS105H1 Computer Fundamentals')).toBeInTheDocument()
  expect(within(card).getByText('Score (%)')).toBeInTheDocument()
  expect(within(card).getByText('90')).toBeInTheDocument()

  await userEvent.click(within(card).getByRole('checkbox', { name: "Don't ask again" }))
  await userEvent.click(within(card).getByRole('button', { name: 'Approve' }))
  expect(await screen.findByText('Recorded 90%.')).toBeInTheDocument()
  expect(srv.sent[1]).toMatchObject({
    path: '/agent/sessions/s1/proposals/pr1:decide',
    body: { decision: 'approve', remember: true },
  })
  // Answered, the card becomes a step line in the folded thinking block, which opens to what
  // changed and where.
  await waitFor(() => expect(card).not.toBeInTheDocument())
  await userEvent.click(await screen.findByRole('button', { name: /1 step/ }))
  const stepLine = await screen.findByRole('button', { name: /Update an assessment/ })
  // The line names what the step was about, without the "Ran" prefix.
  expect(stepLine).toHaveTextContent(
    /^Update an assessment Lab 3 · APS105H1 Computer Fundamentals$/,
  )
  await userEvent.click(stepLine)
  expect(screen.getByText('90')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Open/ })).toBeInTheDocument()
})

test('rejecting asks for an optional reason and sends it', async () => {
  srv.detail.messages = [
    msg('u1', 'user', [{ type: 'text', text: 'Delete Lab 3' }]),
    msg('a1', 'assistant', [
      { type: 'tool_call', id: 'call1', name: 'grading__assessment__delete', args: {} },
    ]),
  ]
  srv.detail.proposals = [
    proposal({ capability: 'grading.assessment.delete', effect: 'destructive', preview: null }),
  ]
  srv.reply = () => sse([])
  renderWithRouter(<Conversation sessionId="s1" pageScope={null} onCreated={() => {}} />)
  const card = await screen.findByLabelText('Delete an assessment')
  // Deleting can never be approved for good.
  expect(within(card).queryByRole('checkbox')).not.toBeInTheDocument()
  await userEvent.click(within(card).getByRole('button', { name: 'Reject' }))
  await userEvent.type(within(card).getByLabelText('Reason (optional)'), 'Wrong lab')
  await userEvent.click(within(card).getByRole('button', { name: 'Reject' }))
  await waitFor(() =>
    expect(srv.sent[0]).toMatchObject({ body: { decision: 'reject', reason: 'Wrong lab' } }),
  )
})

test('/ picks a skill and @ refers to a course, which works in its term', async () => {
  srv.reply = () => sse([])
  renderConversation({ program_id: 'p1', term_id: null, course_id: null })
  const input = await messageInput()
  await userEvent.type(input, '/gr')
  await userEvent.click(await screen.findByRole('option', { name: /Record grades/ }))
  expect(screen.getByText('Record grades')).toBeInTheDocument()
  expect(input).toHaveValue('')

  await userEvent.type(input, 'for @MAT')
  await userEvent.keyboard('{Enter}')
  expect(input).toHaveValue('for @MAT188H1 ')
  expect(await screen.findByRole('button', { name: 'Working in: Winter 2026' })).toBeInTheDocument()

  await userEvent.type(input, '{Enter}')
  await waitFor(() => expect(srv.sent).toHaveLength(1))
  expect(srv.sent[0]?.body).toMatchObject({
    skill: 'record-grades',
    text: 'for @MAT188H1 ',
    scope: { program_id: 'p1', term_id: 't2', course_id: null },
  })
})

test('the scope menu offers the whole program and the terms, the current one first', async () => {
  srv.reply = () => sse([])
  renderConversation({ program_id: 'p1', term_id: null, course_id: null })
  await userEvent.click(await screen.findByRole('button', { name: /^Working in: / }))
  const items = await screen.findAllByRole('menuitemradio')
  expect(items.map((item) => item.textContent)).toEqual([
    'Whole program',
    'Winter 2026Current',
    'Fall 2025',
  ])
  expect(items[0]).toHaveAttribute('aria-checked', 'true')
  await userEvent.click(items[2] as HTMLElement)
  expect(await screen.findByRole('button', { name: 'Working in: Fall 2025' })).toBeInTheDocument()

  await userEvent.type(await messageInput(), 'hi{Enter}')
  await waitFor(() => expect(srv.sent).toHaveLength(1))
  expect(srv.sent[0]?.body.scope).toEqual({ program_id: 'p1', term_id: 't1', course_id: null })
})

test('on a course page the assistant works in the course’s term', async () => {
  function Probe() {
    const scope = usePageScope({ kind: 'course', programId: 'p1', courseId: 'c3' })
    return <span>{scope?.term_id ?? 'program'}</span>
  }
  renderWithRouter(<Probe />)
  // The year-long course runs in both terms; the current one wins.
  expect(await screen.findByText('t2')).toBeInTheDocument()
})

test('an older conversation scoped to a course checks the course’s term', async () => {
  srv.detail.session = session({ scope: { program_id: 'p1', term_id: null, course_id: 'c2' } })
  renderWithRouter(<Conversation sessionId="s1" pageScope={null} onCreated={() => {}} />)
  await userEvent.click(await screen.findByRole('button', { name: /^Working in: MAT188H1/ }))
  expect(await screen.findByRole('menuitemradio', { name: /Winter 2026/ })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  expect(screen.getByRole('menuitemradio', { name: 'Whole program' })).toHaveAttribute(
    'aria-checked',
    'false',
  )
})

test('editing a message sends the new text and drops what came after it', async () => {
  srv.detail.messages = [
    msg('u1', 'user', [{ type: 'text', text: 'What is due?' }]),
    msg('a1', 'assistant', [{ type: 'text', text: 'Lab 3 on Friday.' }]),
    msg('u2', 'user', [{ type: 'text', text: 'And next week?' }]),
    msg('a2', 'assistant', [{ type: 'text', text: 'Nothing.' }]),
  ]
  srv.reply = () => {
    srv.detail.messages = [
      msg('u1', 'user', [{ type: 'text', text: 'What is due this week?' }]),
      msg('a3', 'assistant', [{ type: 'text', text: 'Only Lab 3.' }]),
    ]
    return sse([
      ['message_start', { message_id: 'a3' }],
      ['text_delta', { message_id: 'a3', text: 'Only Lab 3.' }],
      ['message_end', { message_id: 'a3' }],
    ])
  }
  renderWithRouter(<Conversation sessionId="s1" pageScope={null} onCreated={() => {}} />)
  await screen.findByText('Nothing.')
  const [first] = await screen.findAllByRole('button', { name: 'Edit' })
  await userEvent.click(first as HTMLElement)
  const editor = screen.getByRole('textbox', { name: 'Edit message' })
  expect(editor).toHaveValue('What is due?')
  expect(editor).toHaveFocus()
  await userEvent.type(editor, '{Backspace} this week?{Enter}')

  expect(await screen.findByText('Only Lab 3.')).toBeInTheDocument()
  expect(srv.sent[0]).toEqual({
    path: '/agent/sessions/s1/messages/u1:edit',
    body: { text: 'What is due this week?' },
  })
  expect(screen.queryByText('And next week?')).not.toBeInTheDocument()
  expect(screen.queryByRole('textbox', { name: 'Edit message' })).not.toBeInTheDocument()
})

test('an answer that paused at the step limit can be continued', async () => {
  srv.detail.messages = [
    msg('u1', 'user', [{ type: 'text', text: 'Import every course' }]),
    msg('a1', 'assistant', [
      { type: 'text', text: 'Imported 12 of 20.' },
      { type: 'paused', reason: 'tool_limit' },
    ]),
  ]
  let continued = false
  server.use(
    http.post(`${API}/agent/sessions/s1\\:continue`, () => {
      continued = true
      srv.detail.messages = [
        ...srv.detail.messages.slice(0, 1),
        msg('a1', 'assistant', [{ type: 'text', text: 'Imported 12 of 20.' }]),
        msg('a2', 'assistant', [{ type: 'text', text: 'All 20 imported.' }]),
      ]
      return sse([
        ['message_start', { message_id: 'a2' }],
        ['text_delta', { message_id: 'a2', text: 'All 20 imported.' }],
        ['message_end', { message_id: 'a2' }],
      ])
    }),
  )
  renderWithRouter(<Conversation sessionId="s1" pageScope={null} onCreated={() => {}} />)
  expect(await screen.findByText('Sem paused after many steps.')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
  expect(await screen.findByText('All 20 imported.')).toBeInTheDocument()
  expect(continued).toBe(true)
  expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument()
})

test('the editor closes as soon as the edit is sent, while the answer streams', async () => {
  srv.detail.messages = [
    msg('u1', 'user', [{ type: 'text', text: 'What is due?' }]),
    msg('a1', 'assistant', [{ type: 'text', text: 'Lab 3.' }]),
  ]
  let finish: (() => void) | undefined
  srv.reply = () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encode = (text: string) => controller.enqueue(new TextEncoder().encode(text))
        encode('event: message_start\ndata: {"message_id":"a2"}\n\n')
        encode('event: text_delta\ndata: {"message_id":"a2","text":"Streaming"}\n\n')
        finish = () => {
          encode('event: message_end\ndata: {"message_id":"a2"}\n\n')
          controller.close()
        }
      },
    })
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
  }
  renderWithRouter(<Conversation sessionId="s1" pageScope={null} onCreated={() => {}} />)
  await screen.findByText('Lab 3.')
  await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
  await userEvent.type(screen.getByRole('textbox', { name: 'Edit message' }), ' Now?{Enter}')
  expect(await screen.findByText('Streaming')).toBeInTheDocument()
  // Still answering, and the edited text already shows as a bubble.
  expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument()
  expect(screen.queryByRole('textbox', { name: 'Edit message' })).not.toBeInTheDocument()
  expect(screen.getByText('What is due? Now?')).toBeInTheDocument()
  finish?.()
  expect(await screen.findByRole('button', { name: 'Send' })).toBeInTheDocument()
})

test('an edit keeps the skill and attachments and forgets later proposals', () => {
  const detail: AgentSessionDetail = {
    session: session(),
    messages: [
      msg('u1', 'user', [
        { type: 'skill', name: 'record-grades', title: { en: 'Record grades' } },
        { type: 'text', text: 'Lab 3' },
        { type: 'image_ref', attachment_id: 'f1', name: 'a.png' },
      ]),
      msg('a1', 'assistant', [{ type: 'tool_call', id: 'call1', name: 'x', args: {} }]),
    ],
    proposals: [proposal()],
    attachments: [],
    generating: false,
  }
  const edited = withEditedMessage(detail, 'u1', 'Lab 4')
  expect(edited.messages).toHaveLength(1)
  expect(edited.messages[0]?.content.map((b) => b.type)).toEqual(['skill', 'text', 'image_ref'])
  expect(edited.messages[0]?.content[1]).toEqual({ type: 'text', text: 'Lab 4' })
  expect(edited.proposals).toEqual([])
})

test('a suggestion in an empty existing conversation keeps its scope', async () => {
  srv.detail.session = session({ scope: { program_id: 'p1', term_id: null, course_id: 'c2' } })
  renderWithRouter(
    <Conversation
      sessionId="s1"
      pageScope={{ program_id: 'p1', term_id: 't2', course_id: 'c1' }}
      onCreated={() => {}}
    />,
  )
  await userEvent.click(
    await screen.findByRole('button', { name: 'What do I need on the final to get an A?' }),
  )
  await waitFor(() => expect(srv.sent).toHaveLength(1))
  expect(srv.sent[0]?.body.scope ?? null).toBeNull()
})

test('stop asks the server to end the answer', async () => {
  let stopped = false
  server.use(
    http.post(`${API}/agent/sessions/s1\\:stop`, () => {
      stopped = true
      return HttpResponse.json({ stopped: true })
    }),
  )
  let finish: (() => void) | undefined
  srv.reply = () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encode = (text: string) => controller.enqueue(new TextEncoder().encode(text))
        encode('event: message_start\ndata: {"message_id":"a1"}\n\n')
        encode('event: text_delta\ndata: {"message_id":"a1","text":"A long"}\n\n')
        finish = () => {
          encode('event: message_end\ndata: {"message_id":"a1","stopped":true}\n\n')
          controller.close()
        }
      },
    })
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
  }
  renderConversation()
  await userEvent.type(await messageInput(), 'Tell me{Enter}')
  expect(await screen.findByText('A long')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Stop' }))
  await waitFor(() => expect(stopped).toBe(true))
  finish?.()
  expect(await screen.findByRole('button', { name: 'Send' })).toBeInTheDocument()
})

test('history groups pinned first, then by day', () => {
  const now = new Date('2026-10-19T15:00:00')
  const groups = groupSessions(
    [
      session({ id: 'a', updated_at: '2026-10-19T09:00:00' }),
      session({ id: 'b', updated_at: '2026-10-18T09:00:00' }),
      session({ id: 'c', updated_at: '2026-10-15T09:00:00' }),
      session({ id: 'd', updated_at: '2026-09-01T09:00:00', pinned: true }),
      session({ id: 'e', updated_at: '2026-09-01T09:00:00' }),
    ],
    now,
  )
  expect(groups.map((g) => [g.id, g.items.map((s) => s.id)])).toEqual([
    ['pinned', ['d']],
    ['today', ['a']],
    ['yesterday', ['b']],
    ['week', ['c']],
    ['earlier', ['e']],
  ])
})

test('MCP setups carry the address and the token', () => {
  const url = 'https://api.example.com/mcp'
  expect(mcpConfig('claude-code', url, 'spat_x')).toContain(
    'claude mcp add --transport http semestra https://api.example.com/mcp',
  )
  expect(JSON.parse(mcpConfig('cursor', url, 'spat_x'))).toEqual({
    mcpServers: { semestra: { url, headers: { Authorization: 'Bearer spat_x' } } },
  })
  expect(mcpConfig('claude-desktop', url, 'spat_x')).toContain('mcp-remote')
})

test('assistant permissions group tools by effect, with a master switch for changes', async () => {
  const tool = (name: string, effect: string, module = 'grading', confirm = effect !== 'read') => ({
    name,
    module,
    summary: name,
    effect,
    plugin_id: null,
    core: true,
    mcp: true,
    confirm,
  })
  let approved: string[] = []
  const patches: unknown[] = []
  server.use(
    http.get(`${API}/agent/tools`, () =>
      HttpResponse.json({
        items: [
          tool('grading.assessment.list', 'read'),
          tool('grading.assessment.update', 'write'),
          tool('grading.assessment.create', 'write'),
          tool('grading.assessment.delete', 'destructive'),
          tool('layouts.card.add', 'write', 'layouts'),
          // Memory tools run without a card: nothing to approve.
          tool('agent.memory.remember', 'write', 'agent', false),
        ],
      }),
    ),
    http.get(`${API}/agent/preferences`, () =>
      HttpResponse.json({ auto_approve: approved, mcp_allow_destructive: false }),
    ),
    http.patch(`${API}/agent/preferences`, async ({ request }) => {
      const body = (await request.json()) as { auto_approve: string[] }
      patches.push(body)
      approved = body.auto_approve
      return HttpResponse.json({ auto_approve: approved, mcp_allow_destructive: false })
    }),
  )
  renderWithRouter(<ApprovalsSection />)
  // Tools are grouped by effect; only changes have switches, and the lists start folded.
  const all = await screen.findByRole('switch', { name: 'Auto-approve all changes' })
  expect(all).not.toBeChecked()
  expect(screen.getByText('0/3 auto-approved')).toBeInTheDocument()
  expect(screen.getByText('No confirmation')).toBeInTheDocument()
  expect(screen.getByText('Always asks')).toBeInTheDocument()
  expect(screen.queryByRole('switch', { name: 'Update an assessment' })).not.toBeInTheDocument()

  const [, changeTools, deleteTools] = screen.getAllByRole('button', { name: /^\d tools/ })
  await userEvent.click(deleteTools!)
  expect(await screen.findByText('Delete an assessment')).toBeInTheDocument()
  expect(screen.queryByRole('switch', { name: 'Delete an assessment' })).not.toBeInTheDocument()

  await userEvent.click(changeTools!)
  // A backend module without a frontend module still gets a readable name.
  expect(
    screen.getByRole('switch', { name: 'Auto-approve changes in Pages and cards' }),
  ).toBeInTheDocument()
  const update = await screen.findByRole('switch', { name: 'Update an assessment' })
  await userEvent.click(update)
  await waitFor(() => expect(patches).toEqual([{ auto_approve: ['grading.assessment.update'] }]))
  expect(update).toBeChecked()
  // Partly on: the master switch stays off but says so.
  expect(await screen.findByText('Partly on · 1/3')).toBeInTheDocument()
  expect(all).not.toBeChecked()

  // Turning many changes on at once asks first; cancelling changes nothing.
  await userEvent.click(all)
  let confirm = await screen.findByRole('alertdialog', { name: 'Auto-approve all 3 changes?' })
  await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }))
  expect(patches).toHaveLength(1)
  await userEvent.click(all)
  confirm = await screen.findByRole('alertdialog', { name: 'Auto-approve all 3 changes?' })
  await userEvent.click(within(confirm).getByRole('button', { name: 'Auto-approve' }))
  await waitFor(() =>
    expect(patches.at(-1)).toEqual({
      auto_approve: ['grading.assessment.create', 'grading.assessment.update', 'layouts.card.add'],
    }),
  )
  await waitFor(() => expect(all).toBeChecked())
  // Turning them off needs no confirmation.
  await userEvent.click(all)
  await waitFor(() => expect(patches.at(-1)).toEqual({ auto_approve: [] }))
})

function reasoningStream() {
  let next: ((text: string) => void) | undefined
  let finish: (() => void) | undefined
  srv.reply = () => {
    srv.detail.messages = [
      msg('u1', 'user', [{ type: 'text', text: 'Is there a final?' }]),
      msg('a1', 'assistant', [
        { type: 'reasoning', text: 'Checking the syllabus.' },
        { type: 'text', text: 'Yes, worth 40%. It is on Dec 12.' },
        { type: 'timing', thinking_ms: 1200 },
      ]),
    ]
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encode = (name: string, data: unknown) =>
          controller.enqueue(
            new TextEncoder().encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`),
          )
        encode('message_start', { message_id: 'a1' })
        encode('reasoning_delta', { message_id: 'a1', text: 'Checking the syllabus.' })
        next = (text) => encode('text_delta', { message_id: 'a1', text })
        finish = () => {
          encode('message_end', { message_id: 'a1' })
          controller.close()
        }
      },
    })
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
  }
  return { answer: (text: string) => next?.(text), finish: () => finish?.() }
}

test('the thinking block is open while the model thinks and folds once it answers', async () => {
  const turn = reasoningStream()
  renderWithRouter(<Conversation sessionId="s1" pageScope={null} onCreated={() => {}} />)
  await userEvent.type(await messageInput(), 'Is there a final?{Enter}')
  const trigger = await screen.findByRole('button', { name: /Thinking/ })
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByText('Checking the syllabus.')).toBeVisible()

  turn.answer('Yes, worth 40%.')
  expect(await screen.findByText('Yes, worth 40%.')).toBeInTheDocument()
  const folded = screen.getByRole('button', { name: /Thought for/ })
  expect(folded).toHaveAttribute('aria-expanded', 'false')

  // Opened by hand, it stays open.
  await userEvent.click(folded)
  expect(folded).toHaveAttribute('aria-expanded', 'true')
  turn.answer(' It is on Dec 12.')
  turn.finish()
  expect(await screen.findByRole('button', { name: 'Send' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Thought for/ })).toHaveAttribute(
    'aria-expanded',
    'true',
  )
})

test('with thinking text turned off, the block keeps only the steps and the time', async () => {
  assistantSettings = { show_reasoning: false }
  srv.detail.messages = [
    msg('u1', 'user', [{ type: 'text', text: 'Is there a final?' }]),
    msg('a1', 'assistant', [
      { type: 'reasoning', text: 'Checking the syllabus.' },
      { type: 'text', text: 'Yes, worth 40%.' },
      { type: 'timing', thinking_ms: 4200 },
    ]),
  ]
  renderWithRouter(<Conversation sessionId="s1" pageScope={null} onCreated={() => {}} />)
  expect(await screen.findByText('Yes, worth 40%.')).toBeInTheDocument()
  expect(await screen.findByText('Thought for 4s')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Thought for/ })).not.toBeInTheDocument()
  expect(screen.queryByText('Checking the syllabus.')).not.toBeInTheDocument()
})

test('code is highlighted under a header with its language and a copy button', async () => {
  srv.detail.messages = [
    msg('u1', 'user', [{ type: 'text', text: 'Hello world in C++?' }]),
    msg('a1', 'assistant', [{ type: 'text', text: '```c++\nint main() { return 0; }\n```' }]),
  ]
  renderWithRouter(<Conversation sessionId="s1" pageScope={null} onCreated={() => {}} />)
  const title = await screen.findByText('c++')
  const block = title.closest('[data-slot=code-block]') as HTMLElement
  expect(within(block).getByRole('button', { name: /copy/i })).toBeInTheDocument()
  await waitFor(() => expect(block.querySelector('[style*="--shiki-light"]')).not.toBeNull())
})

test('messages do not pin themselves to the top: the transcript follows the newest one', async () => {
  srv.detail.messages = [
    msg('u1', 'user', [{ type: 'text', text: 'What is due?' }]),
    msg('a1', 'assistant', [{ type: 'text', text: 'Lab 3.' }]),
  ]
  renderWithRouter(<Conversation sessionId="s1" pageScope={null} onCreated={() => {}} />)
  await screen.findByText('Lab 3.')
  // Scroll anchors moved the view whenever a sent message got its stored id (round 5, #13).
  expect(document.querySelector('[data-scroll-anchor=true]')).toBeNull()
})

test('on the page, attaching a file to a new conversation keeps the text being typed', async () => {
  server.use(
    http.post(`${API}/agent/attachments`, () =>
      HttpResponse.json({
        id: 'f1',
        session_id: 's1',
        kind: 'file',
        name: 'notes.txt',
        mime: 'text/plain',
        size: 5,
        created_at: NOW,
      }),
    ),
  )
  const root = createRootRoute({ component: Outlet })
  function Page() {
    const { sessionId } = page.useParams()
    const navigate = useNavigate()
    return (
      <AssistantPage
        programId="p1"
        sessionId={sessionId ?? null}
        onNavigate={(id, options) =>
          void navigate({
            to: '/p/$programId/assistant/{-$sessionId}',
            params: { programId: 'p1', sessionId: id ?? undefined },
            replace: options?.replace,
          })
        }
      />
    )
  }
  const page = createRoute({
    getParentRoute: () => root,
    path: '/p/$programId/assistant/{-$sessionId}',
    component: Page,
  })
  const router = createRouter({
    routeTree: root.addChildren([page]),
    history: createMemoryHistory({ initialEntries: ['/p/p1/assistant'] }),
  })
  render(
    <QueryClientProvider client={newQueryClient()}>
      <SidebarProvider>
        <RouterProvider router={router} />
      </SidebarProvider>
    </QueryClientProvider>,
  )
  const input = await messageInput()
  await userEvent.type(input, 'Look at this')
  fireEvent.change(document.querySelector('input[type=file]') as HTMLInputElement, {
    target: { files: [new File(['notes'], 'notes.txt', { type: 'text/plain' })] },
  })
  await waitFor(() => expect(router.state.location.pathname).toBe('/p/p1/assistant/s1'))
  expect(await screen.findByText('notes.txt')).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Look at this')
})

test('files dropped in quick succession into a new conversation create it once', async () => {
  const creates: unknown[] = []
  let uploads = 0
  server.use(
    http.post(`${API}/agent/sessions`, async ({ request }) => {
      creates.push(await request.json())
      await new Promise((resolve) => setTimeout(resolve, 20))
      return HttpResponse.json(srv.detail.session)
    }),
    http.post(`${API}/agent/attachments`, () => {
      uploads += 1
      return HttpResponse.json({
        id: `f${uploads}`,
        session_id: 's1',
        kind: 'file',
        name: `notes${uploads}.txt`,
        mime: 'text/plain',
        size: 5,
        created_at: NOW,
      })
    }),
  )
  const view = renderConversation()
  await messageInput()
  const picker = document.querySelector('input[type=file]') as HTMLInputElement
  fireEvent.change(picker, {
    target: { files: [new File(['a'], 'a.txt', { type: 'text/plain' })] },
  })
  fireEvent.change(picker, {
    target: { files: [new File(['b'], 'b.txt', { type: 'text/plain' })] },
  })
  await waitFor(() => expect(uploads).toBe(2))
  expect(creates).toHaveLength(1)
  expect(creates[0]).toMatchObject({ client_key: expect.any(String) })
  expect(view.created()).toBe('s1')
})

test('an attachment of a sent message can be saved to a course of the term', async () => {
  const saved: { path: string; body: unknown }[] = []
  server.use(
    http.post(`${API}/agent/attachments/:id`, async ({ request }) => {
      saved.push({ path: new URL(request.url).pathname, body: await request.json() })
      return HttpResponse.json({ id: 'fi1', course_id: 'c2', display_name: 'notes.txt' })
    }),
  )
  srv.detail.session = session({ scope: { program_id: 'p1', term_id: 't2', course_id: null } })
  srv.detail.messages = [
    msg('u1', 'user', [
      { type: 'text', text: 'Keep this' },
      { type: 'file_ref', attachment_id: 'f1', name: 'notes.txt' },
    ]),
  ]
  renderWithRouter(
    <Conversation sessionId="s1" pageScope={{ program_id: 'p1' }} onCreated={() => {}} />,
  )
  await userEvent.click(
    await screen.findByRole('button', { name: 'Save notes.txt to course files' }),
  )
  await userEvent.click(await screen.findByRole('menuitem', { name: 'MAT188H1' }))
  await waitFor(() => expect(saved).toHaveLength(1))
  expect(saved[0]).toEqual({ path: '/agent/attachments/f1:save', body: { course_id: 'c2' } })
})

test('an attachment saved before shows where it went and opens the saved file', async () => {
  server.use(
    http.get(`${API}/files/:id`, () =>
      HttpResponse.json({ id: 'fi1', course_id: 'c2', display_name: 'notes.txt', kind: 'file' }),
    ),
  )
  srv.detail.session = session({ scope: { program_id: 'p1', term_id: 't2', course_id: null } })
  srv.detail.attachments = [
    {
      id: 'f1',
      session_id: 's1',
      kind: 'file',
      name: 'notes.txt',
      mime: 'text/plain',
      size: 5,
      created_at: NOW,
      file_item_id: 'fi1',
    },
  ]
  srv.detail.messages = [
    msg('u1', 'user', [{ type: 'file_ref', attachment_id: 'f1', name: 'notes.txt' }]),
  ]
  renderWithRouter(
    <Conversation sessionId="s1" pageScope={{ program_id: 'p1' }} onCreated={() => {}} />,
  )
  await userEvent.click(await screen.findByRole('button', { name: 'Saved to MAT188H1' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Open the saved file' }))
  expect(await screen.findByRole('dialog')).toBeInTheDocument()
})

test('what Sem remembered shows under the answer and can be undone', async () => {
  let memories = [
    {
      id: 'm1',
      category: 'preference',
      content: 'Likes short bullet points',
      created_at: NOW,
      updated_at: NOW,
    },
  ]
  const deleted: string[] = []
  server.use(
    http.get(`${API}/agent/memories`, () => HttpResponse.json({ items: memories })),
    http.delete(`${API}/agent/memories/:id`, ({ params }) => {
      deleted.push(String(params.id))
      memories = []
      return new HttpResponse(null, { status: 204 })
    }),
  )
  const step = (
    callId: string,
    memory: { id: string; content: string; action?: 'remembered' | 'forgot' } | null,
  ) => ({
    callId,
    name: 'agent.memory.remember',
    args: {},
    status: 'done' as const,
    errorCode: null,
    proposal: null,
    memory,
    display: null,
    changed: true,
  })
  render(
    <QueryClientProvider client={newQueryClient()}>
      {/* m1 was edited in settings since: the current wording shows. m2 was deleted
          elsewhere: it is not offered for undo. */}
      <Remembered
        steps={[
          step('c1', { id: 'm1', content: 'Likes bullet points', action: 'remembered' }),
          step('c2', { id: 'm2', content: 'Gone' }),
          step('c3', null),
          step('c4', { id: 'm3', content: 'Works Fridays', action: 'forgot' }),
        ]}
      />
    </QueryClientProvider>,
  )
  expect(await screen.findByText('Remembered: Likes short bullet points')).toBeInTheDocument()
  expect(screen.queryByText('Remembered: Gone')).not.toBeInTheDocument()
  expect(screen.getByText('Forgot: Works Fridays')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
  await waitFor(() => expect(deleted).toEqual(['m1']))
  await waitFor(() =>
    expect(screen.queryByText('Remembered: Likes short bullet points')).not.toBeInTheDocument(),
  )
  expect(screen.getByText('Forgot: Works Fridays')).toBeInTheDocument()
})

test('steps sit under the sentence the model said before them, folded to it', async () => {
  srv.detail.messages = [
    msg('u1', 'user', [{ type: 'text', text: 'When is Lab 3 due?' }]),
    msg('a1', 'assistant', [
      { type: 'text', text: 'Looking up **Lab 3** in your gradebook.' },
      { type: 'tool_call', id: 'c1', name: 'grading__assessment__find', args: {} },
      { type: 'tool_call', id: 'c2', name: 'grading__assessment__find', args: {} },
      { type: 'timing', thinking_ms: 2400 },
    ]),
    msg('t1', 'tool', [
      { type: 'tool_result', call_id: 'c1', name: 'x', is_error: false },
      { type: 'tool_result', call_id: 'c2', name: 'x', is_error: false },
    ]),
    msg('a2', 'assistant', [{ type: 'text', text: 'Lab 3 is due Friday.' }]),
  ]
  renderWithRouter(<Conversation sessionId="s1" pageScope={null} onCreated={() => {}} />)
  expect(await screen.findByText('Lab 3 is due Friday.')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: /Thought for/ }))
  const group = screen.getByRole('button', { name: /Looking up Lab 3 in your gradebook/ })
  expect(group).toHaveTextContent('2 steps')
  expect(group).toHaveAttribute('aria-expanded', 'false')
  await userEvent.click(group)
  expect(group).toHaveAttribute('aria-expanded', 'true')
})
