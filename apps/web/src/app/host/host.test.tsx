import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Timer } from 'lucide-react'
import { http, HttpResponse } from 'msw'
import type { ReactElement } from 'react'
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest'
import template from '@/modules/_template/manifest'
import { FakeEventSource } from '@/test-event-source'
import { API, renderWithRouter, server } from '@/test-utils'
import type { Scope } from '../extensions'
import { useRealtime } from '../realtime'
import { ModuleRegistry, useExtensions } from '../registry'
import { CardGrid } from './CardGrid'
import { StatusBar } from './StatusBar'
import { ScopeNav } from './ScopeNav'
import { ScopePage } from './ScopePage'
import { PluginSettingsSections, SettingsSections } from '../settings/SettingsSections'

beforeAll(() => server.listen())
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const scope: Scope = { kind: 'term', programId: 'p1', termId: 't1' }

const job = {
  id: 'j1',
  kind: 'files.parse',
  status: 'running',
  progress: 40,
  step: 'parsing',
  step_current: 2,
  step_total: 5,
  result: null,
  error_code: null,
  error_params: null,
  attempts: 1,
  max_attempts: 3,
  cancel_requested: false,
  created_at: '2026-01-01T00:00:00Z',
  started_at: '2026-01-01T00:00:01Z',
  finished_at: null,
}

function withTemplate(ui: ReactElement) {
  return renderWithRouter(<ModuleRegistry value={[template]}>{ui}</ModuleRegistry>)
}

test('scope nav lists the pages of the scope with links', async () => {
  withTemplate(<ScopeNav scope={scope} activePageId="template" />)
  const link = await screen.findByRole('link', { name: 'Background tasks' })
  expect(link).toHaveAttribute('href', '/p/p1/t/t1/template')
  expect(link).toHaveAttribute('aria-current', 'page')
})

test('a page renders, follows job progress events, and can cancel a job', async () => {
  let current = job
  let cancelled = false
  let listCalls = 0
  server.use(
    http.get(`${API}/jobs`, () => {
      listCalls += 1
      return HttpResponse.json({ items: [current], next_cursor: null })
    }),
    http.get(`${API}/jobs/j1`, () => HttpResponse.json(current)),
    http.post(`${API}/jobs/j1/cancel`, () => {
      cancelled = true
      return HttpResponse.json({ ...job, cancel_requested: true })
    }),
  )
  function Live() {
    useRealtime()
    return <ScopePage scope={scope} pageId="template" />
  }
  withTemplate(<Live />)

  expect(await screen.findByText('files.parse')).toBeInTheDocument()
  expect(screen.getByRole('progressbar', { name: 'Working… 2/5' })).toHaveAttribute('value', '40')

  const progress = { job_id: 'j1', kind: 'files.parse', status: 'running', progress: 60 }
  FakeEventSource.last().emit({
    type: 'core.job.progress',
    data: { ...progress, step: 'parsing', step_current: 3, step_total: 5 },
  })
  expect(await screen.findByRole('progressbar', { name: 'Working… 3/5' })).toBeInTheDocument()
  expect(listCalls).toBe(1) // patched in place, not refetched

  current = { ...job, status: 'succeeded', progress: 100 }
  FakeEventSource.last().emit({
    type: 'core.job.progress',
    data: { ...progress, status: 'succeeded' },
  })
  expect(await screen.findAllByText('Done')).not.toHaveLength(0)

  current = job
  FakeEventSource.last().emit({
    type: 'core.job.progress',
    data: { ...progress, status: 'running' },
  })
  await userEvent.click(await screen.findByRole('button', { name: 'Stop task files.parse' }))
  await waitFor(() => expect(cancelled).toBe(true))
})

test('unknown page ids show the unavailable state', async () => {
  withTemplate(<ScopePage scope={scope} pageId="nope" />)
  expect(await screen.findByText('Page unavailable')).toBeInTheDocument()
})

test('list errors show a retry button', async () => {
  let fail = true
  server.use(
    http.get(`${API}/jobs`, () =>
      fail
        ? HttpResponse.json(
            { error: { code: 'common.unavailable', params: {}, request_id: 'r' } },
            { status: 503 },
          )
        : HttpResponse.json({ items: [], next_cursor: null }),
    ),
  )
  withTemplate(<ScopePage scope={scope} pageId="template" />)
  expect(await screen.findByText('This feature is currently unavailable.')).toBeInTheDocument()
  fail = false
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(await screen.findByText('No background tasks yet.')).toBeInTheDocument()
})

test('cards render on the grid with their data', async () => {
  server.use(
    http.get(`${API}/storage/usage`, () =>
      HttpResponse.json({ used_bytes: 1024, quota_bytes: 52_428_800, by_module: {} }),
    ),
    http.get(`${API}/layouts/boards/term/t1`, () =>
      HttpResponse.json({
        scope_type: 'term',
        scope_id: 't1',
        customized: false,
        updated_at: null,
        cards: [
          { instance_id: 'c1', card_id: 'template.storage', size: 'm', x: 0, y: 0, settings: {} },
        ],
      }),
    ),
  )
  withTemplate(<CardGrid scope={scope} />)
  expect(await screen.findByText('Storage')).toBeInTheDocument()
  expect(await screen.findByTestId('storage-usage')).toHaveTextContent('1 kB of 50 MB used')
})

test('account settings sections render by level and generate their form from the backend', async () => {
  const values = { compact: false }
  server.use(
    http.get(`${API}/settings/schemas`, () =>
      HttpResponse.json({
        items: [
          {
            namespace: 'plugin.template',
            levels: ['account'],
            plugin_id: 'template',
            json_schema: {
              type: 'object',
              properties: { compact: { type: 'boolean', default: false } },
            },
          },
        ],
      }),
    ),
    http.get(`${API}/settings/plugin.template`, () =>
      HttpResponse.json({
        namespace: 'plugin.template',
        scope_type: 'account',
        scope_id: null,
        values,
        sources: { compact: 'default' },
      }),
    ),
  )
  // The template's section belongs to a plugin: it shows on the plugin's page, not in the
  // account navigation.
  withTemplate(<PluginSettingsSections pluginId="template" />)
  expect(await screen.findByRole('switch', { name: 'Compact task list' })).not.toBeChecked()
})

test('plugin sections stay out of the account navigation level listing', async () => {
  withTemplate(<SettingsSections level="account" />)
  await waitFor(() => expect(screen.queryByText('Template settings')).not.toBeInTheDocument())
})

test('the status bar shows running jobs and module items, and hides empty lines', async () => {
  server.use(
    http.get(`${API}/jobs`, () =>
      HttpResponse.json({ items: [job, { ...job, id: 'j2' }], next_cursor: null }),
    ),
  )
  const timer = {
    ...template,
    id: 'timer',
    statusItems: [
      {
        id: 'timer.running',
        order: 1,
        useStatus: () => ({ icon: Timer, label: '12:00 left', to: '/' }),
      },
      { id: 'timer.idle', order: 2, useStatus: () => null },
    ],
  }
  renderWithRouter(
    <ModuleRegistry value={[timer]}>
      <StatusBar />
    </ModuleRegistry>,
  )
  const bar = await screen.findByRole('list', { name: 'In progress' })
  expect(await screen.findByText('2 tasks running')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '12:00 left' })).toHaveAttribute('href', '/')
  expect(bar.querySelectorAll('li')).toHaveLength(2)
})

test('extension points collect contributions from every module', () => {
  function Probe() {
    return <p>{useExtensions<string>('academics.courseColumns').join(',')}</p>
  }
  const contributor = { ...template, id: 'x', extensions: { 'academics.courseColumns': ['grade'] } }
  render(
    <ModuleRegistry value={[template, contributor]}>
      <Probe />
    </ModuleRegistry>,
  )
  expect(screen.getByText('grade')).toBeInTheDocument()
})
