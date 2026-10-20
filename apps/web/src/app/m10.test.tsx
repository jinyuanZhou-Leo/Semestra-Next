import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest'
import template from '@/modules/_template/manifest'
import plugins from '@/modules/plugins/manifest'
import { API, renderWithRouter, server } from '@/test-utils'
import { SidebarProvider } from '@/ui/sidebar'
import { openCommandPalette } from './commands'
import { CommandCenter } from './commands/CommandCenter'
import type { ModuleManifest, Scope } from './extensions'
import { CardGrid } from './host/CardGrid'
import { orderPages, useSaveNav } from './host/nav'
import { PageHeader } from './host/PageHeader'
import { ScopeNav } from './host/ScopeNav'
import { mergeJobs, StatusBar, visibleJobs } from './host/StatusBar'
import { InstalledPluginsProvider, ModuleRegistry, useModules } from './registry'

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => {
  server.resetHandlers()
  vi.restoreAllMocks()
})
afterAll(() => server.close())

const scope: Scope = { kind: 'term', programId: 'p1', termId: 't1' }

function board(cards: { instance_id: string; card_id: string }[]) {
  return {
    scope_type: 'term',
    scope_id: 't1',
    customized: true,
    updated_at: null,
    cards: cards.map((c, i) => ({
      ...c,
      size: 'm',
      x: (i % 2) * 2,
      y: Math.floor(i / 2),
      settings: {},
    })),
  }
}

function wideScreen() {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: true,
        media: query,
        onchange: null,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  )
}

test('a board edit that fails to save is rolled back', async () => {
  wideScreen()
  let saves = 0
  server.use(
    http.get(`${API}/storage/usage`, () =>
      HttpResponse.json({ used_bytes: 0, quota_bytes: 1, by_module: {} }),
    ),
    http.get(`${API}/layouts/boards/term/t1`, () =>
      HttpResponse.json(board([{ instance_id: 'c1', card_id: 'template.storage' }])),
    ),
    http.put(`${API}/layouts/boards/term/t1`, () => {
      saves += 1
      return HttpResponse.json(
        { error: { code: 'common.internal', params: {}, request_id: 'r' } },
        { status: 500 },
      )
    }),
  )
  renderWithRouter(
    <ModuleRegistry value={[template]}>
      <CardGrid scope={scope} />
    </ModuleRegistry>,
  )
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Edit layout' }))
  await user.click(screen.getByRole('button', { name: 'Remove Storage' }))
  expect(screen.queryByRole('region', { name: 'Storage' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Done' }))
  await waitFor(() => expect(saves).toBe(1))
  expect(await screen.findByRole('region', { name: 'Storage' })).toBeInTheDocument()
})

test('narrow screens can edit cards but not drag them', async () => {
  server.use(
    http.get(`${API}/storage/usage`, () =>
      HttpResponse.json({ used_bytes: 0, quota_bytes: 1, by_module: {} }),
    ),
    http.get(`${API}/layouts/boards/term/t1`, () =>
      HttpResponse.json(board([{ instance_id: 'c1', card_id: 'template.storage' }])),
    ),
  )
  renderWithRouter(
    <ModuleRegistry value={[template]}>
      <CardGrid scope={scope} />
    </ModuleRegistry>,
  )
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Edit layout' }))
  expect(screen.getByRole('button', { name: 'Remove Storage' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Move Storage' })).not.toBeInTheDocument()
})

test('a board cannot be edited before the installed plugins are known', async () => {
  server.use(
    http.get(`${API}/plugins/catalog`, async () => {
      await delay('infinite')
      return HttpResponse.json({ items: [] })
    }),
    http.get(`${API}/storage/usage`, () =>
      HttpResponse.json({ used_bytes: 0, quota_bytes: 1, by_module: {} }),
    ),
    http.get(`${API}/layouts/boards/term/t1`, () =>
      HttpResponse.json(board([{ instance_id: 'c1', card_id: 'template.storage' }])),
    ),
  )
  renderWithRouter(
    <ModuleRegistry value={[plugins, template]}>
      <InstalledPluginsProvider>
        <CardGrid scope={scope} />
      </InstalledPluginsProvider>
    </ModuleRegistry>,
  )
  const buttons = await screen.findAllByRole('button', { name: 'Edit layout' })
  for (const button of buttons) expect(button).toBeDisabled()
})

test('a board cannot be edited while it is refetched', async () => {
  let loads = 0
  server.use(
    http.get(`${API}/storage/usage`, () =>
      HttpResponse.json({ used_bytes: 0, quota_bytes: 1, by_module: {} }),
    ),
    http.get(`${API}/layouts/boards/term/t1`, async () => {
      loads += 1
      if (loads > 1) await delay('infinite')
      return HttpResponse.json(board([{ instance_id: 'c1', card_id: 'template.storage' }]))
    }),
  )
  const { queryClient } = renderWithRouter(
    <ModuleRegistry value={[template]}>
      <CardGrid scope={scope} />
    </ModuleRegistry>,
  )
  const edit = await screen.findByRole('button', { name: 'Edit layout' })
  expect(edit).toBeEnabled()
  // A reinstalled plugin invalidates the board; its cards are missing until the refetch ends.
  act(() => void queryClient.invalidateQueries())
  await waitFor(() => expect(screen.getByRole('button', { name: 'Edit layout' })).toBeDisabled())
})

test('with a page header, "Edit layout" is an icon button there and the edit controls take the place of its buttons and subtitle', async () => {
  server.use(
    http.get(`${API}/storage/usage`, () =>
      HttpResponse.json({ used_bytes: 0, quota_bytes: 1, by_module: {} }),
    ),
    http.get(`${API}/layouts/boards/term/t1`, () =>
      HttpResponse.json(board([{ instance_id: 'c1', card_id: 'template.storage' }])),
    ),
  )
  renderWithRouter(
    <ModuleRegistry value={[template]}>
      <PageHeader title="Fall 2026" subtitle="Sep 2 – Dec 4" />
      <CardGrid scope={scope} />
    </ModuleRegistry>,
  )
  const user = userEvent.setup()
  const edit = await screen.findByRole('button', { name: 'Edit layout' })
  expect(screen.getAllByRole('button', { name: 'Edit layout' })).toHaveLength(1)
  expect(screen.getByText('Sep 2 – Dec 4')).toBeInTheDocument()
  await waitFor(() => expect(edit).toBeEnabled())
  await user.click(edit)
  expect(await screen.findByRole('button', { name: 'Done' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Add card' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Edit layout' })).not.toBeInTheDocument()
  expect(screen.queryByText('Sep 2 – Dec 4')).not.toBeInTheDocument()
  expect(screen.getByRole('heading', { level: 1, name: 'Fall 2026' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Done' }))
  expect(await screen.findByText('Sep 2 – Dec 4')).toBeInTheDocument()
})

test('tabs follow the saved order and leave hidden pages out', async () => {
  const second = {
    ...template,
    id: 'second',
    pages: [{ ...template.pages[0], id: 'second', title: () => 'Second page', order: 2000 }],
  } satisfies ModuleManifest
  server.use(
    http.get(`${API}/layouts/nav/term`, () =>
      HttpResponse.json({ scope_type: 'term', order: ['second'], hidden: ['template'] }),
    ),
  )
  renderWithRouter(
    <ModuleRegistry value={[template, second]}>
      <ScopeNav scope={scope} />
    </ModuleRegistry>,
  )
  expect(await screen.findByRole('link', { name: 'Second page' })).toBeInTheDocument()
  await waitFor(() =>
    expect(screen.queryByRole('link', { name: 'Background tasks' })).not.toBeInTheDocument(),
  )
  expect(orderPages([{ id: 'a' }, { id: 'b' }, { id: 'c' }], { order: ['c', 'a'] })).toEqual([
    { id: 'c' },
    { id: 'a' },
    { id: 'b' },
  ])
})

test('hiding a page from Manage pages saves it for the scope type', async () => {
  let saved: unknown = null
  server.use(
    http.get(`${API}/layouts/nav/term`, () =>
      HttpResponse.json({ scope_type: 'term', order: [], hidden: [] }),
    ),
    http.put(`${API}/layouts/nav/term`, async ({ request }) => {
      saved = await request.json()
      return HttpResponse.json({ scope_type: 'term', ...(saved as object) })
    }),
  )
  renderWithRouter(
    <ModuleRegistry value={[template]}>
      <ScopeNav scope={scope} />
    </ModuleRegistry>,
  )
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Page options' }))
  await user.click(await screen.findByRole('menuitem', { name: 'Manage pages' }))
  const dialog = await screen.findByRole('dialog', { name: 'Manage pages' })
  await user.click(within(dialog).getByRole('switch', { name: 'Show Background tasks' }))
  await waitFor(() => expect(saved).toEqual({ order: ['template'], hidden: ['template'] }))
})

test('a page change made before the stored nav loads keeps the ids it does not show', async () => {
  let saved: unknown = null
  server.use(
    http.get(`${API}/layouts/nav/term`, () =>
      HttpResponse.json({ scope_type: 'term', order: ['gone', 'template'], hidden: ['gone'] }),
    ),
    http.put(`${API}/layouts/nav/term`, async ({ request }) => {
      saved = await request.json()
      return HttpResponse.json({ scope_type: 'term', ...(saved as object) })
    }),
  )
  function Saver() {
    const save = useSaveNav('term')
    return (
      <button
        type="button"
        onClick={() => void save({ order: ['template'], hidden: ['template'] })}
      >
        Save
      </button>
    )
  }
  renderWithRouter(<Saver />)
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(saved).toEqual({ order: ['template', 'gone'], hidden: ['template', 'gone'] }),
  )
})

test('the palette ranks courses by pinyin initials and lists only actions after /', async () => {
  const courses: ModuleManifest = {
    ...template,
    id: 'courses',
    kind: 'core',
    pages: [],
    commands: [],
    navigationSources: [
      {
        id: 'courses',
        useItems: () => [
          { id: 'c1', title: '高等数学', to: '/c1' },
          { id: 'c2', title: 'Linear Algebra', to: '/c2' },
        ],
      },
    ],
  }
  server.use(
    http.post(`${API}/me/ui-state\\:get`, () => HttpResponse.json({ items: {} })),
    http.put(`${API}/me/ui-state/:key`, () => HttpResponse.json({ ok: true })),
    http.get(`${API}/layouts/nav/:kind`, () =>
      HttpResponse.json({ scope_type: 'program', order: [], hidden: [] }),
    ),
  )
  renderWithRouter(
    <ModuleRegistry value={[template, courses]}>
      <CommandCenter />
    </ModuleRegistry>,
  )
  const user = userEvent.setup()
  act(() => openCommandPalette())
  const input = await screen.findByRole('combobox', { name: 'Command palette' })
  await user.type(input, 'gdsx')
  expect(await screen.findByRole('option', { name: '高等数学' })).toBeInTheDocument()
  expect(screen.queryByRole('option', { name: 'Linear Algebra' })).not.toBeInTheDocument()
  await user.clear(input)
  await user.type(input, '/')
  expect(await screen.findByRole('option', { name: 'Go to home' })).toBeInTheDocument()
  expect(screen.queryByRole('option', { name: '高等数学' })).not.toBeInTheDocument()
})

test('plugins appear once the catalog says they are installed', async () => {
  let installed = false
  server.use(
    http.get(`${API}/plugins/catalog`, () =>
      HttpResponse.json({
        items: [
          {
            id: 'template',
            kind: 'plugin',
            name_key: 'template_name',
            description_key: 'template_description',
            summary: '',
            version: '1.0.0',
            author: 'Semestra',
            default_installed: false,
            installed,
            installed_at: null,
            provides: { pages: [], cards: [], capabilities: [] },
          },
        ],
      }),
    ),
  )
  function Ids() {
    return (
      <p>
        {useModules()
          .map((module) => module.id)
          .join(',')}
      </p>
    )
  }
  const { queryClient } = renderWithRouter(
    <ModuleRegistry value={[plugins, template]}>
      <InstalledPluginsProvider>
        <Ids />
      </InstalledPluginsProvider>
    </ModuleRegistry>,
  )
  expect(await screen.findByText('plugins')).toBeInTheDocument()
  installed = true
  await queryClient.invalidateQueries()
  expect(await screen.findByText('plugins,template')).toBeInTheDocument()
})

test('the status bar keeps running jobs, recent successes and unseen failures', () => {
  const now = Date.parse('2026-01-01T00:00:10Z')
  const job = (id: string, status: string, finished: string | null) =>
    ({ id, status, finished_at: finished }) as Parameters<typeof visibleJobs>[0][number]
  const jobs = [
    job('run', 'running', null),
    job('done-now', 'succeeded', '2026-01-01T00:00:09Z'),
    job('done-old', 'succeeded', '2026-01-01T00:00:01Z'),
    job('failed', 'failed', '2026-01-01T00:00:05Z'),
    job('failed-seen', 'failed', '2026-01-01T00:00:05Z'),
    job('cancelled', 'cancelled', '2026-01-01T00:00:09Z'),
  ]
  expect(visibleJobs(jobs, ['failed-seen'], now).map((j) => j.id)).toEqual([
    'run',
    'done-now',
    'failed',
  ])
  // A long-running job older than the recent page still counts.
  const old = job('0-old-running', 'running', null)
  expect(mergeJobs(jobs.slice(1), [old, jobs[0]!]).map((j) => j.id)).toContain('0-old-running')
})

test('a failed job stays listed while its list is open and goes once it closes', async () => {
  const failed = {
    id: 'j1',
    kind: 'files.parse',
    status: 'failed',
    progress: 30,
    step: null,
    step_current: null,
    step_total: null,
    result: null,
    error_code: 'common.internal',
    error_params: {},
    attempts: 1,
    max_attempts: 1,
    cancel_requested: false,
    created_at: new Date().toISOString(),
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
  }
  server.use(
    http.get(`${API}/jobs`, () => HttpResponse.json({ items: [failed], next_cursor: null })),
    http.get(`${API}/jobs/j1`, () => HttpResponse.json(failed)),
    http.post(`${API}/me/ui-state\\:get`, () => HttpResponse.json({ items: {} })),
    http.put(`${API}/me/ui-state/:key`, () => HttpResponse.json({ ok: true })),
  )
  renderWithRouter(
    <ModuleRegistry value={[]}>
      <SidebarProvider>
        <StatusBar />
      </SidebarProvider>
    </ModuleRegistry>,
  )
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: /failed/ }))
  expect(await screen.findByText('Background tasks')).toBeInTheDocument()
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(screen.getByText('Background tasks')).toBeInTheDocument()
  await user.keyboard('{Escape}')
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: /failed/ })).not.toBeInTheDocument(),
  )
})
