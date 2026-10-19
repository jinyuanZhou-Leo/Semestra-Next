import type { CourseLink, CourseOverview, NavTab } from '@semestra/api-client'
import { QueryClientProvider } from '@tanstack/react-query'
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import type { Scope } from '@/app/extensions'
import { ModuleRegistry, usePageStatuses } from '@/app/registry'
import { API, apiError, newQueryClient, renderWithQuery, server } from '@/test-utils'
import CanvasCoursePage from './CanvasCoursePage'
import canvasTab from './manifest'
import { homeView, navEntries, resolveLocation } from './navigation'

const openImport = vi.hoisted(() =>
  vi.fn<(request: unknown) => Promise<null>>(() => Promise.resolve(null)),
)
vi.mock('@/modules/imports/launcher', () => ({ openImport }))

beforeAll(() => server.listen())
afterEach(() => {
  server.resetHandlers()
  openImport.mockClear()
})
afterAll(() => server.close())

const SCOPE: Scope = { kind: 'course', programId: 'p1', courseId: 'c1' }

function tab(kind: NavTab['kind'], label: string, overrides: Partial<NavTab> = {}): NavTab {
  return {
    external_id: overrides.external_id ?? kind,
    web_url: `https://q.utoronto.ca/courses/101/${kind}`,
    kind,
    label,
    position: 0,
    hidden: false,
    ...overrides,
  }
}

const NAV: NavTab[] = [
  tab('home', 'Home', { position: 1 }),
  tab('announcements', 'Announcements', { position: 2 }),
  tab('assignments', 'Assignments', { position: 3 }),
  tab('files', 'Files', { position: 4 }),
  tab('discussions', 'Discussions', { position: 5 }),
  tab('modules', 'Modules', { position: 6 }),
  tab('pages', 'Pages', { position: 7 }),
  tab('syllabus', 'Syllabus', { position: 8 }),
  tab('grades', 'Grades', { position: 9, hidden: true }),
  tab('external', 'Piazza', { position: 10, external_id: 'context_external_tool_7' }),
  tab('unknown', 'Collaborations', { position: 11, external_id: 'collaborations' }),
]

const LINK: CourseLink = {
  id: 'l1',
  course_id: 'c1',
  program_id: 'p1',
  connection_id: 'k1',
  provider: 'canvas',
  external_course_id: '101',
  external_code: 'APS105H1',
  external_name: 'Computer Fundamentals',
  external_term: '2026 Fall',
  web_url: 'https://q.utoronto.ca/courses/101',
  sync_enabled: false,
  last_synced_at: null,
  last_error_code: null,
  created_at: '2026-09-01T10:00:00Z',
}

function overview(defaultView: string | null = 'feed'): CourseOverview {
  return {
    link: LINK,
    provider: 'canvas',
    provider_name: 'Canvas',
    features: ['navigation', 'announcements', 'assignments', 'modules', 'pages', 'syllabus'],
    course: {
      external_id: '101',
      name: 'Computer Fundamentals',
      code: 'APS105H1',
      term: '2026 Fall',
      default_view: defaultView,
      is_current: true,
    },
    navigation: NAV,
    default_view: defaultView,
    truncated: false,
  }
}

const ANNOUNCEMENTS = {
  items: [
    {
      external_id: 'a1',
      title: 'Midterm room change',
      html: '<p>See the <a href="https://q.utoronto.ca/courses/101/pages/rooms" data-lms-kind="page" data-lms-ref="rooms">rooms page</a>.</p><script>alert(1)</script>',
      author: 'Prof. Lee',
      posted_at: '2026-10-01T15:00:00Z',
      unread: true,
    },
  ],
  truncated: false,
}

let saved: Record<string, unknown> = {}
const puts = vi.fn<(key: string, value: unknown) => void>()

beforeEach(() => {
  saved = {}
  puts.mockClear()
  server.use(
    http.post(`${API}/me/ui-state\\:get`, async ({ request }) => {
      const { keys = [], prefixes = [] } = (await request.json()) as {
        keys?: string[]
        prefixes?: string[]
      }
      const items = Object.fromEntries(
        Object.entries(saved).filter(
          ([key]) => keys.includes(key) || prefixes.some((p) => key.startsWith(p)),
        ),
      )
      return HttpResponse.json({ items })
    }),
    http.put(`${API}/me/ui-state/:key`, async ({ request, params }) => {
      const { value } = (await request.json()) as { value: unknown }
      puts(String(params.key), value)
      return HttpResponse.json({ ok: true })
    }),
    http.get(`${API}/courses/c1/lms-link`, () =>
      HttpResponse.json({ course_id: 'c1', link: LINK, program_connection_id: 'k1' }),
    ),
    http.get(`${API}/courses/c1/lms`, () => HttpResponse.json(overview())),
    http.get(`${API}/courses/c1/lms/announcements`, () => HttpResponse.json(ANNOUNCEMENTS)),
    http.get(`${API}/ai/status`, () =>
      HttpResponse.json({
        items: [
          {
            purpose: 'extraction',
            available: true,
            source: 'default',
            provider_id: null,
            model: null,
          },
        ],
      }),
    ),
  )
})

function renderPage(path = '/') {
  const queryClient = newQueryClient()
  const root = createRootRoute({ component: Outlet })
  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    validateSearch: (search: Record<string, unknown>) => search as Record<string, string>,
    component: () => <CanvasCoursePage scope={SCOPE} />,
  })
  const router = createRouter({
    routeTree: root.addChildren([index]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { router, queryClient }
}

// --- pure rules ------------------------------------------------------------------------------

test('the menu mirrors Canvas: native views, external tools, unknown tabs; files and discussions hidden', () => {
  const entries = navEntries(NAV)
  expect(entries.map((e) => e.label)).toEqual([
    'Home',
    'Announcements',
    'Assignments',
    'Modules',
    'Pages',
    'Syllabus',
    'Piazza',
    'Collaborations',
  ])
  expect(entries.find((e) => e.label === 'Piazza')).toMatchObject({
    kind: 'external',
    key: 'tab:context_external_tool_7',
  })
  expect(entries.find((e) => e.label === 'Collaborations')?.kind).toBe('unknown')
  // A native view still opens when its tab is hidden (a module item can point to it).
  expect(resolveLocation({ tab: 'grades' }, entries)).toMatchObject({
    kind: 'native',
    view: 'grades',
  })
  expect(resolveLocation({ tab: 'tab:gone' }, entries)).toMatchObject({
    kind: 'native',
    view: 'home',
  })
})

test.each([
  ['wiki', 'front_page'],
  ['modules', 'modules'],
  ['syllabus', 'syllabus'],
  ['assignments', 'assignments'],
  ['feed', 'announcements'],
  [null, 'modules'],
] as const)('default_view %s opens %s', (value, view) => {
  expect(homeView(value)).toBe(view)
})

// --- availability ----------------------------------------------------------------------------

function PageStatus() {
  const statuses = usePageStatuses(SCOPE)
  return <p>{statuses.map((s) => `${s.page.id}:${s.status}`).join(',')}</p>
}

test.each([
  ['a Canvas link', { course_id: 'c1', link: LINK, program_connection_id: 'k1' }, 'available'],
  ['no link', { course_id: 'c1', link: null, program_connection_id: 'k1' }, 'unavailable'],
  [
    'a link to another platform',
    { course_id: 'c1', link: { ...LINK, provider: 'moodle' }, program_connection_id: 'k1' },
    'unavailable',
  ],
])('the Canvas page with %s is %s', async (_, state, expected) => {
  server.use(http.get(`${API}/courses/c1/lms-link`, () => HttpResponse.json(state)))
  renderWithQuery(
    <ModuleRegistry value={[canvasTab]}>
      <PageStatus />
    </ModuleRegistry>,
  )
  expect(screen.getByText('canvas:pending')).toBeInTheDocument()
  expect(await screen.findByText(`canvas:${expected}`)).toBeInTheDocument()
})

// --- the page --------------------------------------------------------------------------------

test('the home of a feed course lists announcements; HTML is cleaned and Canvas links open in place', async () => {
  server.use(
    http.get(`${API}/courses/c1/lms/pages/rooms`, () =>
      HttpResponse.json({
        external_id: '9',
        ref: 'rooms',
        title: 'Exam rooms',
        html: '<p>BA 1130</p>',
        web_url: 'https://q.utoronto.ca/courses/101/pages/rooms',
      }),
    ),
  )
  const { router } = renderPage()
  const nav = await screen.findByRole('navigation', { name: 'Course menu' })
  expect(within(nav).queryByRole('button', { name: 'Files' })).toBeNull()
  expect(within(nav).queryByRole('button', { name: 'Discussions' })).toBeNull()
  expect(within(nav).getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page')

  await userEvent.click(
    await screen.findByRole('button', {
      name: /^Unread Midterm room change/,
    }),
  )
  expect(router.state.location.search).toMatchObject({ tab: 'announcements', ref: 'a1' })
  await waitFor(() =>
    expect(puts).toHaveBeenCalledWith('canvas-tab.location.c1', {
      tab: 'announcements',
      ref: 'a1',
    }),
  )
  expect(document.querySelector('script')).toBeNull()

  await userEvent.click(screen.getByRole('link', { name: 'rooms page' }))
  expect(await screen.findByText('BA 1130')).toBeInTheDocument()
  expect(router.state.location.search).toMatchObject({ tab: 'pages', ref: 'rooms' })
})

test('a wiki course opens on its front page', async () => {
  const refs: string[] = []
  server.use(
    http.get(`${API}/courses/c1/lms`, () => HttpResponse.json(overview('wiki'))),
    http.get(`${API}/courses/c1/lms/pages/:ref`, ({ params }) => {
      refs.push(String(params.ref))
      return HttpResponse.json({
        external_id: '2',
        ref: 'welcome',
        title: 'Welcome',
        front_page: true,
        html: '<p>Hello class</p>',
      })
    }),
  )
  renderPage()
  expect(await screen.findByText('Hello class')).toBeInTheDocument()
  expect(refs).toEqual(['@front'])
})

test('a wiki course without a front page shows its modules', async () => {
  server.use(
    http.get(`${API}/courses/c1/lms`, () => HttpResponse.json(overview('wiki'))),
    http.get(`${API}/courses/c1/lms/pages/:ref`, () => {
      const { status, body } = apiError('common.not_found', 404)
      return HttpResponse.json(body, { status })
    }),
    http.get(`${API}/courses/c1/lms/modules`, () =>
      HttpResponse.json({
        items: [{ external_id: 'm1', name: 'Week 1', position: 1, item_count: 0 }],
        truncated: false,
      }),
    ),
  )
  renderPage()
  expect(await screen.findByText('Week 1')).toBeInTheDocument()
})

test('an item this account may not see points to Canvas, not to the API token', async () => {
  server.use(
    http.get(`${API}/courses/c1/lms/syllabus`, () => {
      const { status, body } = apiError('lms.forbidden', 403)
      return HttpResponse.json(body, { status })
    }),
  )
  renderPage('/?tab=syllabus')
  const alert = await screen.findByRole('alert')
  expect(within(alert).getByText("You can't view this")).toBeInTheDocument()
  expect(within(alert).getByRole('button', { name: 'Open in Canvas' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Open connection settings' })).toBeNull()
})

test('external tools get a launch card and unknown tabs open in Canvas', async () => {
  renderPage()
  const nav = await screen.findByRole('navigation', { name: 'Course menu' })
  await userEvent.click(within(nav).getByRole('button', { name: 'Piazza' }))
  expect(
    await screen.findByText('This is an external tool. It only runs inside Canvas.'),
  ).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Launch in Canvas' })).toHaveAttribute(
    'href',
    'https://q.utoronto.ca/courses/101/external',
  )
  await userEvent.click(within(nav).getByRole('button', { name: 'Collaborations' }))
  expect(await screen.findByText("This page can't be shown here yet")).toBeInTheDocument()
})

test('the remembered place is restored and put in the URL', async () => {
  saved = { 'canvas-tab.location.c1': { tab: 'syllabus' } }
  server.use(
    http.get(`${API}/courses/c1/lms/syllabus`, () =>
      HttpResponse.json({ html: '<p>Grading: 40% final</p>', web_url: null }),
    ),
  )
  const { router } = renderPage()
  expect(await screen.findByText('Grading: 40% final')).toBeInTheDocument()
  await waitFor(() => expect(router.state.location.search).toMatchObject({ tab: 'syllabus' }))
})

test('a link with a place wins over the remembered one and is remembered', async () => {
  saved = { 'canvas-tab.location.c1': { tab: 'syllabus' } }
  const { router } = renderPage('/?tab=announcements')
  expect(await screen.findByRole('button', { name: /Midterm room change/ })).toBeInTheDocument()
  await waitFor(() =>
    expect(puts).toHaveBeenCalledWith('canvas-tab.location.c1', { tab: 'announcements' }),
  )
  expect(router.state.location.search).toMatchObject({ tab: 'announcements' })
})

test('an invalid token leads to the connection settings', async () => {
  server.use(
    http.get(`${API}/courses/c1/lms`, () => {
      const { status, body } = apiError('lms.invalid_credentials', 400)
      return HttpResponse.json(body, { status })
    }),
  )
  renderPage()
  expect(
    await screen.findByRole('button', { name: 'Open connection settings' }),
  ).toBeInTheDocument()
})

test('ticked assignments go to the gradebook import review', async () => {
  const body = vi.fn<(body: unknown) => void>()
  server.use(
    http.get(`${API}/courses/c1/lms/assignments`, () =>
      HttpResponse.json({
        items: [
          {
            external_id: 'x1',
            name: 'Lab 1',
            group_id: 'g1',
            group_name: 'Labs',
            group_weight: 20,
            points: 10,
            imported_as: [],
          },
          {
            external_id: 'x2',
            name: 'Lab 2',
            group_id: 'g1',
            group_name: 'Labs',
            points: 10,
            imported_as: [{ kind: 'assessment', id: 'as1' }],
          },
        ],
        truncated: false,
      }),
    ),
    http.post(`${API}/courses/c1/lms/imports\\:assignments`, async ({ request }) => {
      body(await request.json())
      return HttpResponse.json({ session_id: 's1', program_id: 'p1', count: 1 })
    }),
  )
  renderPage('/?tab=assignments')
  expect(await screen.findByText('20% of grade', { exact: false })).toBeInTheDocument()
  expect(screen.getByRole('checkbox', { name: 'Select Lab 2' })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
  const toGradebook = screen.getByRole('button', { name: 'Import to gradebook' })
  expect(toGradebook).toBeDisabled()
  await userEvent.click(screen.getByRole('checkbox', { name: 'Select Lab 1' }))
  await userEvent.click(toGradebook)
  await waitFor(() => expect(openImport).toHaveBeenCalled())
  expect(body).toHaveBeenCalledWith({ external_ids: ['x1'], as_kind: 'assessment' })
  expect(openImport).toHaveBeenCalledWith(
    expect.objectContaining({ programId: 'p1', source: 'session', sessionId: 's1' }),
  )
})

test('a module file can be saved to the course files', async () => {
  const saves = vi.fn<(url: string) => void>()
  server.use(
    http.get(`${API}/courses/c1/lms/modules`, () =>
      HttpResponse.json({
        items: [{ external_id: 'm1', name: 'Week 1', position: 1, item_count: 1 }],
        truncated: false,
      }),
    ),
    http.get(`${API}/courses/c1/lms/modules/m1/items`, () =>
      HttpResponse.json({
        items: [
          {
            external_id: 'i1',
            title: 'Slides.pdf',
            kind: 'file',
            target: { kind: 'file', ref: 'f1' },
          },
        ],
        truncated: false,
      }),
    ),
    http.post(`${API}/courses/c1/lms/files/f1\\:save`, ({ request }) => {
      saves(request.url)
      return HttpResponse.json({ file_item_id: 'fi1', name: 'Slides.pdf' })
    }),
  )
  renderPage('/?tab=modules&ref=m1')
  await userEvent.click(
    await screen.findByRole('button', { name: 'Save Slides.pdf to course files' }),
  )
  await waitFor(() => expect(saves).toHaveBeenCalled())
  expect(screen.getByRole('button', { name: 'Download Slides.pdf' })).toHaveAttribute(
    'href',
    `${API}/courses/c1/lms/files/f1/content?download=true`,
  )
})

test('smart import of the syllabus opens its review', async () => {
  const started = vi.fn<() => void>()
  server.use(
    http.get(`${API}/courses/c1/lms/syllabus`, () =>
      HttpResponse.json({ html: '<p>Grading: 40% final</p>', web_url: null }),
    ),
    http.post(`${API}/courses/c1/lms/imports\\:syllabus`, () => {
      started()
      return HttpResponse.json({ session_id: 's2', program_id: 'p1', count: 0 })
    }),
  )
  renderPage('/?tab=syllabus')
  await userEvent.click(await screen.findByRole('button', { name: 'Smart import' }))
  await waitFor(() =>
    expect(openImport).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'session', sessionId: 's2' }),
    ),
  )
  expect(started).toHaveBeenCalledOnce()
})
