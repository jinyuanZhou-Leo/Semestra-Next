import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest'
import { API, renderWithQuery, server } from '@/test-utils'
import type { SettingsSectionContribution } from '../extensions'
import { NamespaceForm } from './NamespaceForm'
import { SectionFrame } from './SettingsSections'

beforeAll(() => server.listen())
afterEach(() => {
  cleanup()
  server.resetHandlers()
})
afterAll(() => server.close())

const NAMESPACE = 'plugin.template'

const schemas = {
  items: [
    {
      namespace: NAMESPACE,
      levels: ['account', 'program'],
      plugin_id: 'template',
      json_schema: {
        type: 'object',
        properties: {
          compact: { type: 'boolean', default: false, title: 'Compact' },
          greeting: { type: 'string', enum: ['formal', 'casual'], default: 'casual' },
          countdown_steps: { type: 'integer', minimum: 1, maximum: 20, default: 3 },
        },
      },
    },
  ],
}

type Resolved = {
  values: Record<string, unknown>
  sources: Record<string, string>
  inherited?: Record<string, { value: unknown; source: string }>
}

/** An in-memory backend for one namespace; `patches` and `resets` record what was sent. */
function backend(initial: Resolved) {
  const state = {
    ...initial,
    patches: [] as Record<string, unknown>[],
    resets: [] as string[],
    scopes: [] as string[],
  }
  const resolved = (scopeType: string) => ({
    namespace: NAMESPACE,
    scope_type: scopeType,
    scope_id: scopeType === 'account' ? null : 'p1',
    values: state.values,
    sources: state.sources,
    inherited: state.inherited ?? {},
  })
  server.use(
    http.get(`${API}/settings/schemas`, () => HttpResponse.json(schemas)),
    http.get(`${API}/settings/${NAMESPACE}`, ({ request }) => {
      const type = new URL(request.url).searchParams.get('scope_type') ?? 'account'
      state.scopes.push(type)
      return HttpResponse.json(resolved(type))
    }),
    http.patch(`${API}/settings/${NAMESPACE}`, async ({ request }) => {
      const body = (await request.json()) as {
        scope_type: string
        values: Record<string, unknown>
      }
      state.patches.push(body.values)
      for (const [key, value] of Object.entries(body.values)) {
        state.values[key] = value
        state.sources[key] = body.scope_type
      }
      return HttpResponse.json(resolved(body.scope_type))
    }),
    http.delete(`${API}/settings/${NAMESPACE}/keys/:key`, ({ params, request }) => {
      const key = String(params.key)
      state.resets.push(key)
      state.values[key] = key === 'compact' ? false : state.values[key]
      state.sources[key] = 'account'
      return HttpResponse.json(resolved(new URL(request.url).searchParams.get('scope_type')!))
    }),
  )
  return state
}

const defaults = (): Resolved => ({
  values: { compact: false, greeting: 'casual', countdown_steps: 3 },
  sources: { compact: 'default', greeting: 'default', countdown_steps: 'default' },
})

const section: SettingsSectionContribution = {
  id: 'template',
  level: 'account',
  title: () => 'Template',
  order: 1,
  namespace: NAMESPACE,
}

test('controls are generated from the JSON Schema and use the field messages', async () => {
  backend(defaults())
  renderWithQuery(<NamespaceForm namespace={NAMESPACE} level="account" />)

  expect(await screen.findByRole('switch', { name: 'Compact task list' })).not.toBeChecked()
  expect(screen.getByRole('button', { name: 'Casual' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: 'Formal' })).toHaveAttribute('aria-pressed', 'false')
  expect(screen.getByRole('spinbutton', { name: 'Countdown steps' })).toHaveValue(3)
  // Account level has no "inherited" labels.
  expect(screen.queryByText('Default')).not.toBeInTheDocument()
})

test('changes are merged into one request and the section shows Saving… then Saved', async () => {
  const store = backend(defaults())
  renderWithQuery(<SectionFrame section={section} />)

  await userEvent.click(await screen.findByRole('switch', { name: 'Compact task list' }))
  await userEvent.click(screen.getByRole('button', { name: 'Formal' }))
  expect(store.patches).toEqual([])

  expect(await screen.findByText('Saved', {}, { timeout: 3000 })).toBeInTheDocument()
  expect(store.patches).toEqual([{ compact: true, greeting: 'formal' }])
  expect(screen.getByRole('switch', { name: 'Compact task list' })).toBeChecked()
})

test('a value outside the allowed range is flagged and never sent', async () => {
  const store = backend(defaults())
  renderWithQuery(<NamespaceForm namespace={NAMESPACE} level="account" />)

  const input = await screen.findByRole('spinbutton', { name: 'Countdown steps' })
  await userEvent.clear(input)
  await userEvent.type(input, '99')
  expect(await screen.findByRole('alert')).toHaveTextContent('Enter a number from 1 to 20.')

  await userEvent.clear(input)
  await userEvent.type(input, '7')
  await waitFor(() => expect(store.patches).toEqual([{ countdown_steps: 7 }]), { timeout: 3000 })
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

test('a change still waiting for its delay is sent when the form goes away', async () => {
  const store = backend(defaults())
  const { unmount } = renderWithQuery(<NamespaceForm namespace={NAMESPACE} level="account" />)

  await userEvent.click(await screen.findByRole('switch', { name: 'Compact task list' }))
  unmount()
  await waitFor(() => expect(store.patches).toEqual([{ compact: true }]))
})

test('a server error shows a retry that sends the same change again', async () => {
  const store = backend(defaults())
  let fail = true
  server.use(
    http.patch(`${API}/settings/${NAMESPACE}`, async ({ request }) => {
      const body = (await request.json()) as { values: Record<string, unknown> }
      if (fail) return HttpResponse.error()
      store.patches.push(body.values)
      return HttpResponse.json({
        namespace: NAMESPACE,
        scope_type: 'account',
        scope_id: null,
        values: { ...store.values, ...body.values },
        sources: { ...store.sources, compact: 'account' },
        inherited: {},
      })
    }),
  )
  renderWithQuery(<SectionFrame section={section} />)

  await userEvent.click(await screen.findByRole('switch', { name: 'Compact task list' }))
  const retry = await screen.findByRole('button', { name: 'Retry' }, { timeout: 3000 })
  expect(screen.getByText("Couldn't save")).toBeInTheDocument()

  fail = false
  await userEvent.click(retry)
  expect(await screen.findByText('Saved')).toBeInTheDocument()
  expect(store.patches).toEqual([{ compact: true }])
})

const scoped = (): Resolved => ({
  values: { compact: true, greeting: 'casual', countdown_steps: 3 },
  sources: { compact: 'program', greeting: 'account', countdown_steps: 'default' },
  inherited: {
    compact: { value: false, source: 'account' },
    greeting: { value: 'casual', source: 'account' },
    countdown_steps: { value: 3, source: 'default' },
  },
})

test('scoped fields start with "follow" and following removes the value set here', async () => {
  const store = backend(scoped())
  renderWithQuery(
    <NamespaceForm
      namespace={NAMESPACE}
      level="program"
      scope={{ kind: 'program', programId: 'p1' }}
    />,
  )

  // The switch becomes Follow / On / Off; set here, so On is chosen.
  expect(await screen.findByRole('button', { name: 'On' })).toHaveAttribute('aria-pressed', 'true')
  const [followCompact, followGreeting] = screen.getAllByRole('button', { name: 'Follow' })
  expect(followCompact).toHaveAttribute('aria-pressed', 'false')
  expect(followGreeting).toHaveAttribute('aria-pressed', 'true')
  // A typed field names the level it follows; a default comes from the nearest level above.
  expect(screen.getByText('Follow your account (3)')).toBeInTheDocument()
  expect(screen.queryByRole('spinbutton')).toBeNull()
  expect(store.scopes).toEqual(['program'])

  await userEvent.click(followCompact!)
  await waitFor(() => expect(store.resets).toEqual(['compact']))
  await waitFor(() =>
    expect(screen.getAllByRole('button', { name: 'Follow' })[0]).toHaveAttribute(
      'aria-pressed',
      'true',
    ),
  )
})

test('choosing the same value as the level above sets it here instead of following', async () => {
  const store = backend(scoped())
  renderWithQuery(
    <NamespaceForm
      namespace={NAMESPACE}
      level="program"
      scope={{ kind: 'program', programId: 'p1' }}
    />,
  )
  await userEvent.click(await screen.findByRole('button', { name: 'Casual' }))
  await waitFor(() => expect(store.patches).toEqual([{ greeting: 'casual' }]), { timeout: 3000 })
  expect(screen.getByRole('button', { name: 'Casual' })).toHaveAttribute('aria-pressed', 'true')
})

test('a page without the scope the level needs renders nothing and asks for nothing', async () => {
  const store = backend(defaults())
  const { container } = renderWithQuery(<NamespaceForm namespace={NAMESPACE} level="term" />)
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(container).toBeEmptyDOMElement()
  expect(store.scopes).toEqual([])
})

test('Follow waits for a save that is still running, so the reset is applied last', async () => {
  const store = backend(scoped())
  const order: string[] = []
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => (release = resolve))
  server.use(
    http.patch(`${API}/settings/${NAMESPACE}`, async ({ request }) => {
      const body = (await request.json()) as { values: Record<string, unknown> }
      order.push(`patch ${JSON.stringify(body.values)}`)
      await gate
      store.values = { ...store.values, ...body.values }
      return HttpResponse.json({
        namespace: NAMESPACE,
        scope_type: 'program',
        scope_id: 'p1',
        values: store.values,
        sources: {
          ...store.sources,
          ...Object.fromEntries(Object.keys(body.values).map((k) => [k, 'program'])),
        },
        inherited: store.inherited,
      })
    }),
    http.delete(`${API}/settings/${NAMESPACE}/keys/:key`, () => {
      order.push('reset')
      return HttpResponse.json({
        namespace: NAMESPACE,
        scope_type: 'program',
        scope_id: 'p1',
        values: { compact: false, greeting: 'casual', countdown_steps: 3 },
        sources: { compact: 'account', greeting: 'default', countdown_steps: 'default' },
        inherited: store.inherited,
      })
    }),
  )
  renderWithQuery(
    <NamespaceForm
      namespace={NAMESPACE}
      level="program"
      scope={{ kind: 'program', programId: 'p1' }}
    />,
  )

  await userEvent.click(await screen.findByRole('button', { name: 'Formal' }))
  await waitFor(() => expect(order).toHaveLength(1), { timeout: 3000 }) // the save is in flight
  await userEvent.click(screen.getAllByRole('button', { name: 'Follow' })[0]!)
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(order).toEqual(['patch {"greeting":"formal"}']) // the reset has not raced ahead
  release()
  await waitFor(() => expect(order).toEqual(['patch {"greeting":"formal"}', 'reset']))
})
