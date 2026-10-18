import type { Assignment, Provider, PurposeStatus, UsageSummary } from '@semestra/api-client'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { useState } from 'react'
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { AiFieldMark, aiFilledClass } from '@/components/AiFieldMark'
import { AiRequired } from '@/components/AiRequired'
import { AI_FILL_HIGHLIGHT_MS, useAiFill } from '@/hooks/use-ai-fill'
import { AI_PURPOSES } from '@/hooks/use-ai-status'
import { API, apiError, renderWithQuery, renderWithRouter, server } from '@/test-utils'
import { Button } from '@/ui/button'
import { Toaster } from '@/ui/sonner'
import { ModelsSection } from './settings/ModelsSection'
import { ProvidersSection } from './settings/ProvidersSection'
import { UsageSection } from './settings/UsageSection'

beforeAll(() => server.listen())
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function provider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'pv1',
    kind: 'anthropic',
    display_name: 'Anthropic',
    base_url: null,
    key_hint: 'sk-ant-…a1b2',
    capabilities: ['chat', 'tools', 'vision', 'structured'],
    capabilities_editable: false,
    enabled: true,
    last_checked_at: '2026-01-15T12:00:00Z',
    last_error_code: null,
    created_at: '2026-01-15T12:00:00Z',
    updated_at: '2026-01-15T12:00:00Z',
    ...overrides,
  }
}

type World = {
  providers: Provider[]
  assignments: Record<string, { provider_id: string; model: string }>
}
let world: World
const requests: { method: string; path: string; body: unknown }[] = []

function statusItems(): PurposeStatus[] {
  return AI_PURPOSES.map((purpose) => {
    const own = world.assignments[purpose]
    // Like the backend: only the big providers have recommended models.
    const p = world.providers.find(
      (x) =>
        x.enabled &&
        (own ? x.id === own.provider_id : !['openai_compatible', 'ollama'].includes(x.kind)),
    )
    const ok =
      p !== undefined &&
      (own !== undefined || purpose !== 'embedding' || p.capabilities.includes('embedding'))
    return {
      purpose,
      available: ok,
      source: ok ? (own ? 'assignment' : 'default') : null,
      provider_id: ok ? p.id : null,
      provider_kind: ok ? p.kind : null,
      provider_name: ok ? p.display_name : null,
      model: ok ? (own?.model ?? 'claude-sonnet-5-5') : null,
    }
  })
}

function aiHandlers() {
  const record = async (request: Request) => {
    const url = new URL(request.url)
    const body = request.method === 'GET' ? undefined : await request.json().catch(() => undefined)
    requests.push({ method: request.method, path: url.pathname, body })
    return body as Record<string, unknown> | undefined
  }
  return [
    http.get(`${API}/ai/status`, () => HttpResponse.json({ items: statusItems() })),
    http.get(`${API}/ai/providers`, () => HttpResponse.json({ items: world.providers })),
    http.post(`${API}/ai/providers`, async ({ request }) => {
      const body = (await record(request))!
      if (body.api_key === 'bad')
        return HttpResponse.json(
          apiError('ai.provider_check_failed', 400, { reason: 'ai.invalid_key' }).body,
          { status: 400 },
        )
      const created = provider({
        id: `pv${world.providers.length + 1}`,
        kind: body.kind as Provider['kind'],
      })
      world.providers.push(created)
      return HttpResponse.json(created, { status: 201 })
    }),
    http.patch(`${API}/ai/providers/:id`, async ({ request, params }) => {
      const body = (await record(request))!
      const row = world.providers.find((p) => p.id === params.id)!
      Object.assign(row, body)
      return HttpResponse.json(row)
    }),
    http.delete(`${API}/ai/providers/:id`, async ({ request, params }) => {
      await record(request)
      world.providers = world.providers.filter((p) => p.id !== params.id)
      return HttpResponse.json({ id: params.id, cleared_purposes: [] })
    }),
    http.post(`${API}/ai/providers/:id\\:test`, async ({ request }) => {
      await record(request)
      return HttpResponse.json({
        ok: false,
        error_code: 'ai.invalid_key',
        checked_at: '2026-01-15T12:00:00Z',
      })
    }),
    http.get(`${API}/ai/providers/:id/models`, () =>
      HttpResponse.json({
        items: [
          { id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5' },
          { id: 'claude-haiku-5-5', display_name: 'Claude Haiku 5.5' },
        ],
        manual_entry: false,
      }),
    ),
    http.get(`${API}/ai/assignments`, () =>
      HttpResponse.json({
        items: AI_PURPOSES.map((purpose): Assignment => ({
          purpose,
          provider_id: world.assignments[purpose]?.provider_id ?? null,
          model: world.assignments[purpose]?.model ?? null,
          params: {},
          recommended:
            world.providers[0] && purpose !== 'embedding'
              ? { provider_id: world.providers[0].id, model: 'claude-sonnet-5-5' }
              : null,
        })),
      }),
    ),
    http.put(`${API}/ai/assignments`, async ({ request }) => {
      const body = (await record(request)) as {
        purpose: string
        provider_id: string | null
        model?: string
      }
      if (body.provider_id)
        world.assignments[body.purpose] = { provider_id: body.provider_id, model: body.model! }
      else delete world.assignments[body.purpose]
      return HttpResponse.json({ items: [] })
    }),
  ]
}

beforeEach(() => {
  world = { providers: [], assignments: {} }
  requests.length = 0
  server.use(...aiHandlers())
})

test('AiRequired greys out the entry and points to the settings until AI is connected', async () => {
  const user = userEvent.setup()
  const { queryClient } = renderWithRouter(
    <AiRequired purpose="extraction">
      <Button>Import from syllabus</Button>
    </AiRequired>,
  )
  // Once the status is known, the greyed-out entry sits inside a focusable hint trigger.
  const hint = await screen.findByRole('button', { name: 'Import from syllabus', expanded: false })
  expect(within(hint).getByRole('button')).toBeDisabled()
  // Opens on hover in a browser; jsdom has no hover intent, so press the wrapper (as keyboard users do).
  await user.click(hint)
  expect(await screen.findByText('Available once AI is connected in Settings.')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Open Settings' })).toHaveAttribute(
    'href',
    '/settings/features#ai-providers',
  )

  world.providers.push(provider())
  await act(() => queryClient.invalidateQueries())
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Import from syllabus' })).toBeEnabled(),
  )
})

function FillForm() {
  const ai = useAiFill<'code', string>()
  const [code, setCode] = useState('')
  return (
    <div>
      <input
        aria-label="Code"
        value={code}
        className={aiFilledClass(ai.isHighlighted('code'))}
        onChange={(e) => (setCode(e.target.value), ai.accept('code'))}
      />
      <button
        type="button"
        onClick={() => {
          ai.fill('code', code, {
            evidence: { page: 2, quote: 'Course: MAT 137' },
            confidence: 0.9,
          })
          setCode('MAT137')
        }}
      >
        Fill
      </button>
      <AiFieldMark
        filled={ai.get('code')}
        fieldLabel="Code"
        onRevert={() => setCode(ai.revert('code') ?? '')}
      />
    </div>
  )
}

test('AI fill highlights the field, shows where the value came from, and can be reverted', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  try {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithQuery(<FillForm />)
    const input = screen.getByLabelText('Code')
    fireEvent.change(input, { target: { value: 'old' } })
    await user.click(screen.getByRole('button', { name: 'Fill' }))
    expect(input).toHaveValue('MAT137')
    expect(input.className).toContain('ring-2')
    act(() => vi.advanceTimersByTime(AI_FILL_HIGHLIGHT_MS))
    expect(input.className).not.toContain('ring-2')

    await user.click(screen.getByRole('button', { name: 'Filled by AI: Code' }))
    expect(await screen.findByText('Course: MAT 137')).toBeInTheDocument()
    expect(screen.getByText('Page 2')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Restore previous value' }))
    expect(input).toHaveValue('old')
    expect(screen.queryByRole('button', { name: 'Filled by AI: Code' })).not.toBeInTheDocument()
  } finally {
    vi.useRealTimers()
  }
})

test('typing over an AI value drops its mark', async () => {
  const user = userEvent.setup()
  renderWithQuery(<FillForm />)
  await user.click(screen.getByRole('button', { name: 'Fill' }))
  expect(screen.getByRole('button', { name: 'Filled by AI: Code' })).toBeInTheDocument()
  await user.type(screen.getByLabelText('Code'), 'X')
  expect(screen.queryByRole('button', { name: 'Filled by AI: Code' })).not.toBeInTheDocument()
})

test('adding a provider checks the key; a rejected key is explained in the form', async () => {
  const user = userEvent.setup()
  renderWithQuery(<ProvidersSection />)
  expect(await screen.findByText('No provider connected yet.')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Add provider' }))
  const dialog = await screen.findByRole('dialog')
  const save = within(dialog).getByRole('button', { name: 'Check and save' })
  expect(save).toBeDisabled()

  await user.type(within(dialog).getByLabelText('API key'), 'bad')
  await user.click(save)
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    "Couldn't verify the provider: The API key was rejected.",
  )

  await user.clear(within(dialog).getByLabelText('API key'))
  await user.type(within(dialog).getByLabelText('API key'), 'sk-ant-good')
  await user.click(save)
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(requests.at(-1)).toMatchObject({
    method: 'POST',
    body: { kind: 'anthropic', api_key: 'sk-ant-good', base_url: null, capabilities: null },
  })
  expect(await screen.findByText('sk-ant-…a1b2', { exact: false })).toBeInTheDocument()
  // The key itself is never shown again.
  expect(screen.queryByText('sk-ant-good', { exact: false })).not.toBeInTheDocument()
})

test('an OpenAI-compatible endpoint asks for a URL, capabilities and a model for unserved tasks', async () => {
  const user = userEvent.setup()
  renderWithQuery(<ProvidersSection />)
  await user.click(await screen.findByRole('button', { name: 'Add provider' }))
  const dialog = await screen.findByRole('dialog')
  await user.click(within(dialog).getByRole('combobox', { name: 'Provider' }))
  await user.click(await screen.findByRole('option', { name: 'OpenAI-compatible' }))
  expect(within(dialog).getByLabelText('API key (optional)')).toBeInTheDocument()
  await user.type(within(dialog).getByLabelText('Base URL'), 'https://api.deepseek.com/v1')
  await user.click(within(dialog).getByRole('checkbox', { name: 'Images' }))
  await user.type(within(dialog).getByLabelText('Model'), 'deepseek-chat')
  await user.click(within(dialog).getByRole('button', { name: 'Check and save' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

  expect(requests[0]).toMatchObject({
    method: 'POST',
    body: {
      kind: 'openai_compatible',
      base_url: 'https://api.deepseek.com/v1',
      capabilities: ['chat', 'tools', 'vision'],
    },
  })
  // Nothing served these tasks yet, so the typed model now does (embedding was not ticked).
  const assigned = requests.filter((r) => r.method === 'PUT').map((r) => r.body)
  expect(assigned).toEqual(
    ['chat', 'extraction', 'title', 'vision'].map((purpose) => ({
      purpose,
      provider_id: 'pv1',
      model: 'deepseek-chat',
    })),
  )
})

test('a provider can be tested, switched off and deleted after confirming', async () => {
  world.providers.push(provider())
  const user = userEvent.setup()
  renderWithQuery(
    <>
      <ProvidersSection />
      <Toaster />
    </>,
  )
  await user.click(await screen.findByRole('button', { name: 'Test' }))
  expect(
    await screen.findByText('The API key was rejected. Check that it is correct and active.'),
  ).toBeInTheDocument()

  await user.click(screen.getByRole('switch', { name: 'Use Anthropic' }))
  await waitFor(() =>
    expect(requests.at(-1)).toMatchObject({ method: 'PATCH', body: { enabled: false } }),
  )
  expect(await screen.findByText('Off')).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Delete Anthropic' }))
  const confirm = await screen.findByRole('alertdialog')
  await user.click(within(confirm).getByRole('button', { name: 'Delete' }))
  expect(await screen.findByText('No provider connected yet.')).toBeInTheDocument()
  expect(requests.at(-1)).toMatchObject({ method: 'DELETE', path: '/ai/providers/pv1' })
})

test('each purpose shows the model in use and can be switched to another model', async () => {
  world.providers.push(provider())
  const user = userEvent.setup()
  renderWithQuery(<ModelsSection />)
  expect(
    await screen.findAllByText('Using Anthropic · claude-sonnet-5-5 (recommended)'),
  ).toHaveLength(4)
  expect(
    screen.getByText('Not available: connect a provider that supports this.'),
  ).toBeInTheDocument()

  await user.click(screen.getByRole('combobox', { name: 'Provider for Reading documents' }))
  await user.click(await screen.findByRole('option', { name: 'Anthropic' }))
  // The recommended model of that provider is saved straight away …
  await waitFor(() =>
    expect(requests.at(-1)).toMatchObject({
      method: 'PUT',
      body: { purpose: 'extraction', provider_id: 'pv1', model: 'claude-sonnet-5-5' },
    }),
  )
  // … and another model is one pick away.
  await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
  const model = await screen.findByRole('combobox', { name: 'Reading documents' })
  await waitFor(() => expect(model).toHaveTextContent('Claude Sonnet 5.5'))
  await user.click(model)
  await user.click(await screen.findByRole('option', { name: 'Claude Haiku 5.5' }))
  await waitFor(() =>
    expect(requests.at(-1)).toMatchObject({
      body: { purpose: 'extraction', provider_id: 'pv1', model: 'claude-haiku-5-5' },
    }),
  )
  expect(await screen.findByText('Using Anthropic · claude-haiku-5-5')).toBeInTheDocument()
})

const usage: UsageSummary = {
  since: '2026-01-01T00:00:00Z',
  totals: { calls: 12, errors: 1, input_tokens: 40_000, output_tokens: 5_000, cost_usd: 0.21 },
  cost_complete: false,
  by_day: [
    {
      date: '2026-01-14',
      purpose: 'chat',
      input_tokens: 30_000,
      output_tokens: 4_000,
      cost_usd: 0.2,
    },
    {
      date: '2026-01-15',
      purpose: 'extraction',
      input_tokens: 10_000,
      output_tokens: 1_000,
      cost_usd: null,
    },
  ],
  by_purpose: [
    {
      key: 'chat',
      calls: 10,
      errors: 1,
      input_tokens: 30_000,
      output_tokens: 4_000,
      cost_usd: 0.2,
    },
    {
      key: 'extraction',
      calls: 2,
      errors: 0,
      input_tokens: 10_000,
      output_tokens: 1_000,
      cost_usd: null,
    },
  ],
  by_module: [
    {
      key: 'agent',
      calls: 12,
      errors: 1,
      input_tokens: 40_000,
      output_tokens: 5_000,
      cost_usd: 0.21,
    },
  ],
  by_model: [
    {
      key: 'anthropic/claude-sonnet-5-5',
      calls: 10,
      errors: 1,
      input_tokens: 30_000,
      output_tokens: 4_000,
      cost_usd: 0.2,
    },
    {
      key: 'ollama/qwen3:8b',
      calls: 2,
      errors: 0,
      input_tokens: 10_000,
      output_tokens: 1_000,
      cost_usd: 0,
    },
  ],
}

test('usage shows totals, a chart per day and a table that can be grouped and sorted', async () => {
  let query: URLSearchParams | undefined
  server.use(
    http.get(`${API}/ai/usage`, ({ request }) => {
      query = new URL(request.url).searchParams
      return HttpResponse.json(usage)
    }),
  )
  const user = userEvent.setup()
  renderWithQuery(<UsageSection />)
  expect(await screen.findByText('at least $0.21')).toBeInTheDocument()
  expect(query?.get('days')).toBe('30')
  expect(query?.get('tz')).toBeTruthy()
  expect(
    within(screen.getByRole('list', { name: 'Tokens per day' })).getAllByRole('listitem'),
  ).toHaveLength(30)

  // The table is remounted per grouping, so look it up each time.
  const rows = () =>
    within(screen.getByRole('table'))
      .getAllByRole('row')
      .slice(1)
      .map((r) => r.textContent)
  expect(rows()).toEqual(['Assistant10 (1 failed)34,000$0.20', 'Reading documents211,000—'])
  await user.click(within(screen.getByRole('table')).getByRole('button', { name: 'Tokens' }))
  expect(rows()[0]).toContain('Reading documents')

  await user.click(screen.getByRole('radio', { name: 'Model' }))
  expect(rows()).toEqual([
    'claude-sonnet-5-5 (Anthropic)10 (1 failed)34,000$0.20',
    'qwen3:8b (Ollama)211,000$0.00',
  ])
})

test('usage without any requests says so', async () => {
  server.use(
    http.get(`${API}/ai/usage`, () =>
      HttpResponse.json({
        ...usage,
        totals: { calls: 0, errors: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0 },
        cost_complete: true,
        by_day: [],
        by_purpose: [],
        by_module: [],
        by_model: [],
      }),
    ),
  )
  renderWithQuery(<UsageSection />)
  expect(await screen.findByText('No AI requests in the last 30 days.')).toBeInTheDocument()
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
})
