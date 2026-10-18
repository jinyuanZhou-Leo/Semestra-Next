import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
import { ScopeNav } from './ScopeNav'
import { ScopePage } from './ScopePage'
import { SettingsSections } from './SettingsSections'

beforeAll(() => server.listen())
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const scope: Scope = { kind: 'term', programId: 'p1', termId: 't1' }

const job = {
  id: 'j1',
  kind: 'files.parse',
  status: 'running',
  progress: 40,
  step: '2/5',
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

test('a page renders, refetches on job events, and can cancel a job', async () => {
  let current = job
  let cancelled = false
  server.use(
    http.get(`${API}/jobs`, () => HttpResponse.json({ items: [current], next_cursor: null })),
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
  expect(screen.getByRole('progressbar')).toHaveAttribute('value', '40')

  current = { ...job, status: 'succeeded', progress: 100 }
  FakeEventSource.last().emit({ type: 'core.job.updated', data: { id: 'j1' } })
  expect(await screen.findByText('Done')).toBeInTheDocument()

  current = job
  FakeEventSource.last().emit({ type: 'core.job.updated', data: { id: 'j1' } })
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
  )
  withTemplate(<CardGrid scope={scope} />)
  expect(await screen.findByText('Storage')).toBeInTheDocument()
  expect(await screen.findByTestId('storage-usage')).toHaveTextContent('1 kB of 50 MB used')
})

test('settings sections render by level and keep UI preferences', async () => {
  withTemplate(<SettingsSections level="account" />)
  const checkbox = await screen.findByRole('checkbox', { name: 'Compact task list' })
  await userEvent.click(checkbox)
  expect(localStorage.getItem('semestra.ui.template.compact')).toBe('true')
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
