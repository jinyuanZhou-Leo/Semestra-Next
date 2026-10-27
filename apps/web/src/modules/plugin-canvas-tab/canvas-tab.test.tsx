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

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
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
let allowWrites = false

function lmsSettings() {
  return {
    namespace: 'lms',
    scope_type: 'account',
    scope_id: null,
    values: { allow_writes: allowWrites },
    sources: { allow_writes: allowWrites ? 'account' : 'default' },
    inherited: {},
  }
}
const puts = vi.fn<(key: string, value: unknown) => void>()

beforeEach(() => {
  saved = {}
  allowWrites = false
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
    http.get(`${API}/me/settings/lms`, () => HttpResponse.json(lmsSettings())),
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

test('the menu mirrors Canvas: native views, external tools, unknown tabs; discussions hidden', () => {
  const entries = navEntries(NAV)
  expect(entries.map((e) => e.label)).toEqual([
    'Home',
    'Announcements',
    'Assignments',
    'Files',
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
  expect(within(nav).getByRole('button', { name: 'Files' })).toBeInTheDocument()
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

test('tabs the app cannot show open straight in Canvas; a link to one gets a launch card', async () => {
  renderPage('/?tab=tab:context_external_tool_7')
  expect(
    await screen.findByText('This is an external tool. It only runs inside Canvas.'),
  ).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Launch in Canvas' })).toHaveAttribute(
    'href',
    'https://q.utoronto.ca/courses/101/external',
  )
  const nav = screen.getByRole('navigation', { name: 'Course menu' })
  expect(within(nav).getByRole('button', { name: 'Collaborations' })).toHaveAttribute(
    'href',
    'https://q.utoronto.ca/courses/101/unknown',
  )
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

async function openUnreadAnnouncement() {
  const reads = vi.fn<() => void>()
  server.use(
    http.post(`${API}/courses/c1/lms/announcements/a1\\:read`, () => {
      reads()
      return HttpResponse.json({ announcement_id: 'a1', unread: false })
    }),
  )
  const { queryClient } = renderPage('/?tab=announcements&ref=a1')
  expect(await screen.findByRole('heading', { name: 'Midterm room change' })).toBeInTheDocument()
  await waitFor(() =>
    expect(queryClient.isFetching({ queryKey: [{ _id: 'settingsValueGet' }] })).toBe(0),
  )
  return reads
}

test('opening an unread announcement marks it read on Canvas when writes are allowed', async () => {
  allowWrites = true
  const reads = await openUnreadAnnouncement()
  await waitFor(() => expect(reads).toHaveBeenCalledOnce())
  await userEvent.click(screen.getByRole('button', { name: 'Back' }))
  expect(await screen.findByText('Midterm room change')).toBeInTheDocument()
  expect(screen.queryByText('Unread')).toBeNull()
})

test('without the setting, opening an announcement changes nothing on Canvas', async () => {
  const reads = await openUnreadAnnouncement()
  expect(reads).not.toHaveBeenCalled()
})

test('an opened assignment shows when and how to submit, the lock, the grade, comments and rubric', async () => {
  server.use(
    http.get(`${API}/courses/c1/lms/assignments`, () =>
      HttpResponse.json({
        items: [
          {
            external_id: 'x1',
            name: 'Essay',
            points: 20,
            submission_types: ['online_upload', 'online_url'],
            allowed_attempts: 2,
            locked: true,
            lock_explanation: 'This assignment was locked Oct 20 at 11:59pm.',
            rubric: [
              {
                id: 'c1',
                description: 'Argument',
                points: 10,
                ratings: [
                  { id: 'r1', description: 'Strong', points: 10 },
                  { id: 'r2', description: 'Weak', points: 4 },
                ],
              },
            ],
            submission: { state: 'graded', score: 17 },
            imported_as: [],
          },
        ],
        truncated: false,
      }),
    ),
    http.get(`${API}/courses/c1/lms/assignments/x1/submission`, () =>
      HttpResponse.json({
        external_id: 's1',
        assignment_id: 'x1',
        state: 'graded',
        score: 17,
        grade: '17',
        attempt: 1,
        comments: [{ author: 'TA Kim', comment: 'Nice structure.' }],
        rubric_scores: [{ criterion_id: 'c1', points: 8, rating_id: 'r1', comments: 'Clear' }],
      }),
    ),
  )
  renderPage('/?tab=assignments&ref=x1')
  expect(await screen.findByText('File upload, Website URL')).toBeInTheDocument()
  expect(screen.getByText('2 allowed')).toBeInTheDocument()
  expect(screen.getByText('This assignment was locked Oct 20 at 11:59pm.')).toBeInTheDocument()
  expect(await screen.findByText('Nice structure.')).toBeInTheDocument()
  expect(screen.getByText('Score 17 / 20 · Attempt 1')).toBeInTheDocument()
  const rubric = screen.getByRole('row', { name: /Argument/ })
  expect(within(rubric).getByText('Strong')).toBeInTheDocument()
  expect(within(rubric).getByText('8 / 10')).toBeInTheDocument()
  expect(within(rubric).getByText('Clear')).toBeInTheDocument()
})

test('modules show progress, prerequisites, locks and what finishing an item takes', async () => {
  server.use(
    http.get(`${API}/courses/c1/lms/modules`, () =>
      HttpResponse.json({
        items: [
          { external_id: 'm1', name: 'Week 1', position: 1, item_count: 1, state: 'completed' },
          {
            external_id: 'm2',
            name: 'Week 2',
            position: 2,
            item_count: 1,
            state: 'locked',
            prerequisite_module_ids: ['m1'],
            require_sequential_progress: true,
          },
        ],
        truncated: false,
      }),
    ),
    http.get(`${API}/courses/c1/lms/modules/m2/items`, () =>
      HttpResponse.json({
        items: [
          {
            external_id: 'i2',
            title: 'Quiz 2',
            kind: 'quiz',
            target: { kind: 'quiz', ref: 'q2' },
            locked: true,
            lock_explanation: 'Finish Week 1 first.',
            completion: { type: 'min_score', min_score: 7, completed: false },
          },
        ],
        truncated: false,
      }),
    ),
  )
  renderPage('/?tab=modules&ref=m2')
  expect(await screen.findByText('Completed')).toBeInTheDocument()
  expect(screen.getByText('Locked')).toBeInTheDocument()
  expect(
    await screen.findByText('Finish first: Week 1 · Items must be done in order'),
  ).toBeInTheDocument()
  expect(await screen.findByRole('button', { name: 'Finish Week 1 first.' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Score at least 7: not done yet' })).toBeInTheDocument()
})

test('inline module items show without asking for them again', async () => {
  const itemReads = vi.fn<() => void>()
  server.use(
    http.get(`${API}/courses/c1/lms/modules`, () =>
      HttpResponse.json({
        items: [
          {
            external_id: 'm1',
            name: 'Week 1',
            position: 1,
            item_count: 1,
            items: [{ external_id: 'i1', title: 'Reading list', kind: 'page' }],
          },
        ],
        truncated: false,
      }),
    ),
    http.get(`${API}/courses/c1/lms/modules/:id/items`, () => {
      itemReads()
      return HttpResponse.json({ items: [], truncated: false })
    }),
  )
  renderPage('/?tab=modules&ref=m1')
  expect(await screen.findByText('Reading list')).toBeInTheDocument()
  expect(itemReads).not.toHaveBeenCalled()
})

test('Refresh drops the course cache once; later reads use the cache again', async () => {
  const refreshes = vi.fn<() => void>()
  const reads: string[] = []
  server.use(
    http.post(`${API}/courses/c1/lms\\:refresh`, () => {
      refreshes()
      return HttpResponse.json({ course_id: 'c1', link: LINK, program_connection_id: 'k1' })
    }),
    http.get(`${API}/courses/c1/lms/announcements`, ({ request }) => {
      reads.push(new URL(request.url).search)
      return HttpResponse.json(ANNOUNCEMENTS)
    }),
  )
  renderPage('/?tab=announcements')
  await screen.findByRole('button', { name: /^Unread Midterm room change/ })
  const nav = screen.getByRole('navigation', { name: 'Course menu' })
  await userEvent.click(within(nav).getByRole('button', { name: 'Refresh' }))
  await waitFor(() => expect(reads).toHaveLength(2))
  expect(refreshes).toHaveBeenCalledOnce()
  expect(reads).toEqual(['', ''])
})

test('the files tab browses folders and searches by name', async () => {
  const root = {
    external_id: 'f0',
    name: 'course files',
    path: '',
    files_count: 0,
    folders_count: 1,
  }
  const lectures = {
    external_id: 'f1',
    name: 'Lectures',
    path: 'Lectures',
    parent_id: 'f0',
    files_count: 1,
    folders_count: 0,
  }
  server.use(
    http.get(`${API}/courses/c1/lms/folders`, ({ request }) => {
      const id = new URL(request.url).searchParams.get('folder_id')
      return HttpResponse.json(
        id === 'f1'
          ? {
              folder: lectures,
              trail: [root, lectures],
              folders: [],
              files: [{ external_id: 'd1', name: 'week1.pptx', size_bytes: 2048 }],
            }
          : { folder: root, trail: [root], folders: [lectures], files: [] },
      )
    }),
    http.get(`${API}/courses/c1/lms/files`, () =>
      HttpResponse.json({
        items: [{ external_id: 'd9', name: 'syllabus.docx' }],
        truncated: false,
      }),
    ),
  )
  renderPage('/?tab=files')
  await userEvent.click(await screen.findByRole('button', { name: /Lectures/ }))
  expect(await screen.findByText('week1.pptx')).toBeInTheDocument()
  const trail = screen.getByRole('navigation', { name: 'breadcrumb' })
  expect(within(trail).getByRole('button', { name: 'Files' })).toBeInTheDocument()
  await userEvent.type(screen.getByRole('searchbox', { name: 'Search course files' }), 'syl')
  expect(await screen.findByText('syllabus.docx')).toBeInTheDocument()
})

test('a PowerPoint opens as text, slide by slide', async () => {
  server.use(
    http.get(`${API}/courses/c1/lms/files/d1`, () =>
      HttpResponse.json({
        external_id: 'd1',
        name: 'week1.pptx',
        mime_type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      }),
    ),
    http.get(`${API}/courses/c1/lms/files/d1/preview`, () =>
      HttpResponse.json({
        name: 'week1.pptx',
        mime_type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        kind: 'pptx',
        pages: ['# Intro', 'Pointers'],
        truncated: false,
      }),
    ),
    http.get(`${API}/courses/c1/lms/folders`, () =>
      HttpResponse.json({
        folder: { external_id: 'f0', name: 'course files', path: '' },
        trail: [],
        folders: [],
        files: [{ external_id: 'd1', name: 'week1.pptx' }],
      }),
    ),
  )
  renderPage('/?tab=files')
  await userEvent.click(await screen.findByRole('button', { name: 'Preview week1.pptx' }))
  const dialog = await screen.findByRole('dialog')
  expect(await within(dialog).findByRole('heading', { name: 'Intro' })).toBeInTheDocument()
  expect(within(dialog).getByText('Slide 2')).toBeInTheDocument()
  expect(within(dialog).getByText('Pointers')).toBeInTheDocument()
})
