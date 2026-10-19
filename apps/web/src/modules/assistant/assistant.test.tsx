import type {
  AgentMessageOut,
  AgentScope,
  AgentProposalOut,
  AgentSessionDetail,
  AgentSessionOut,
} from '@semestra/api-client'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { useState } from 'react'
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'vitest'
import { academicsHandlers, defaultWorld } from '@/modules/academics/test-data'
import { API, renderWithRouter, server } from '@/test-utils'
import { Conversation } from './components/Conversation'
import { groupSessions } from './components/SessionList'
import { ApprovalsSection } from './settings/ApprovalsSection'
import { mcpConfig } from './settings/McpSection'
import { parseSse } from './stream'
import { applyEvent, buildItems, canRegenerate } from './transcript'

beforeAll(() => server.listen())
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

beforeEach(() => {
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
  expect(answer?.kind === 'assistant' && answer.text).toBe('Found it.')
  expect(answer?.kind === 'assistant' && answer.steps.map((s) => s.status)).toEqual([
    'done',
    'waiting',
  ])
  expect(answer?.kind === 'assistant' && answer.proposals).toHaveLength(1)
  expect(detail.session.title).toBe('Lab 3 score')
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
  expect(canRegenerate(read, buildItems(read))).toBe('a2')
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
  expect(await within(card).findByText('Done')).toBeInTheDocument()
  expect(within(card).getByRole('button', { name: /Open/ })).toBeInTheDocument()
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

test('/ picks a skill and @ refers to a course', async () => {
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
  expect(await screen.findByRole('button', { name: /Context: MAT188H1/ })).toBeInTheDocument()

  await userEvent.type(input, '{Enter}')
  await waitFor(() => expect(srv.sent).toHaveLength(1))
  expect(srv.sent[0]?.body).toMatchObject({
    skill: 'record-grades',
    text: 'for @MAT188H1 ',
    scope: { program_id: 'p1', course_id: 'c2' },
  })
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

test('auto-approve lists write tools by module and saves the choice', async () => {
  const patches: unknown[] = []
  server.use(
    http.get(`${API}/agent/tools`, () =>
      HttpResponse.json({
        items: [
          {
            name: 'grading.assessment.list',
            module: 'grading',
            summary: 'List',
            effect: 'read',
            plugin_id: null,
            core: true,
            mcp: true,
          },
          {
            name: 'grading.assessment.update',
            module: 'grading',
            summary: 'Update',
            effect: 'write',
            plugin_id: null,
            core: true,
            mcp: true,
          },
          {
            name: 'grading.assessment.delete',
            module: 'grading',
            summary: 'Delete',
            effect: 'destructive',
            plugin_id: null,
            core: false,
            mcp: true,
          },
        ],
      }),
    ),
    http.get(`${API}/agent/preferences`, () =>
      HttpResponse.json({ auto_approve: [], mcp_allow_destructive: false }),
    ),
    http.patch(`${API}/agent/preferences`, async ({ request }) => {
      const body = await request.json()
      patches.push(body)
      return HttpResponse.json({
        auto_approve: ['grading.assessment.update'],
        mcp_allow_destructive: false,
      })
    }),
  )
  renderWithRouter(<ApprovalsSection />)
  const update = await screen.findByRole('checkbox', { name: 'Update an assessment' })
  expect(screen.queryByRole('checkbox', { name: 'Delete an assessment' })).not.toBeInTheDocument()
  expect(screen.queryByRole('checkbox', { name: /List/ })).not.toBeInTheDocument()
  await userEvent.click(update)
  await waitFor(() => expect(patches).toEqual([{ auto_approve: ['grading.assessment.update'] }]))
  expect(update).toBeChecked()
})
