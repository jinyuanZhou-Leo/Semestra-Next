import type { Announcement, CourseLink, TermAnnouncement } from '@semestra/api-client'
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
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest'
import type { Scope } from '@/app/extensions'
import { academicsHandlers, defaultWorld } from '@/modules/academics/test-data'
import { API, newQueryClient, server } from '@/test-utils'
import { announcementSearch, hasAnnouncements } from '../announcements'
import AnnouncementsPage from './AnnouncementsPage'

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const COURSE: Scope = { kind: 'course', programId: 'p1', courseId: 'c1' }
const TERM: Scope = { kind: 'term', programId: 'p1', termId: 't2' }

function post(id: string, overrides: Partial<Announcement> = {}): Announcement {
  return {
    external_id: id,
    external_course_id: '101',
    web_url: `https://q.utoronto.ca/courses/101/discussion_topics/${id}`,
    title: `Post ${id}`,
    html: `<p>Body of ${id}</p>`,
    author: 'Prof. Lee',
    posted_at: '2026-02-10T15:00:00Z',
    updated_at: null,
    unread: false,
    ...overrides,
  }
}

const COURSE_POSTS = [
  post('1', {
    title: 'Midterm room change',
    html: '<p>We moved to <b>BA1160</b>.</p>',
    unread: true,
  }),
  post('2', { title: 'Welcome', posted_at: '2026-01-06T15:00:00Z' }),
]
const TERM_POSTS: TermAnnouncement[] = [
  { ...COURSE_POSTS[0]!, course_id: 'c1' },
  { ...post('7', { title: 'Problem set 3 posted' }), course_id: 'c2' },
]

function link(courseId: string, features: CourseLink['features']): CourseLink {
  return {
    id: `l-${courseId}`,
    course_id: courseId,
    program_id: 'p1',
    connection_id: 'k1',
    provider: 'canvas',
    external_course_id: '101',
    external_code: null,
    external_name: null,
    external_term: null,
    web_url: null,
    sync_enabled: true,
    files_sync: true,
    files_offline: false,
    synced_at: null,
    sync_errors: {},
    features,
    created_at: '2026-01-01T00:00:00Z',
  }
}

function mockApi({ allowWrites }: { allowWrites: boolean }) {
  const marked: string[] = []
  server.use(
    http.get(`${API}/me/settings/lms`, () =>
      HttpResponse.json({
        namespace: 'lms',
        scope_type: 'account',
        scope_id: null,
        values: { allow_writes: allowWrites },
        sources: {},
        inherited: {},
      }),
    ),
    ...academicsHandlers(defaultWorld()),
    http.get(`${API}/courses/:id/lms/announcements`, () =>
      HttpResponse.json({ items: COURSE_POSTS, truncated: false }),
    ),
    http.get(`${API}/terms/:id/lms/announcements`, () =>
      HttpResponse.json({ items: TERM_POSTS, linked_course_ids: ['c1', 'c2'], truncated: false }),
    ),
    http.post(`${API}/courses/:course/lms/announcements/:id\\:read`, ({ params }) => {
      marked.push(`${params.course}:${params.id}`)
      return HttpResponse.json({ announcement_id: params.id, unread: false })
    }),
    http.get(`${API}/courses/:id/lms-link`, ({ params }) =>
      HttpResponse.json({
        course_id: params.id,
        link: link(String(params.id), ['announcements']),
        program_connection_id: 'k1',
      }),
    ),
    http.get(`${API}/lms/providers`, () =>
      HttpResponse.json({
        items: [
          {
            kind: 'canvas',
            display_name: 'Canvas',
            features: ['announcements'],
            config_schema: {},
            credentials_schema: {},
          },
        ],
      }),
    ),
  )
  return marked
}

function renderPage(scope: Scope, path = '/') {
  const root = createRootRoute({ component: Outlet })
  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    validateSearch: (search: Record<string, unknown>) => search as Record<string, string>,
    component: () => <AnnouncementsPage scope={scope} />,
  })
  const router = createRouter({
    routeTree: root.addChildren([index]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  render(
    <QueryClientProvider client={newQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

test('nothing opens by itself; opening an unread one marks it read on the platform', async () => {
  const marked = mockApi({ allowWrites: true })
  const router = renderPage(COURSE)
  const row = await screen.findByRole('button', { name: /Midterm room change/ })
  expect(within(row).getByText('Unread')).toBeInTheDocument()
  expect(within(row).getByText('We moved to BA1160.')).toBeInTheDocument()
  expect(screen.getByText('No announcement selected')).toBeInTheDocument()
  expect(marked).toEqual([])

  await userEvent.click(row)
  expect(await screen.findByRole('heading', { name: 'Midterm room change' })).toBeInTheDocument()
  expect(router.state.location.search).toEqual({ post: 'c1:1' })
  await waitFor(() => expect(marked).toEqual(['c1:1']))
  await waitFor(() => expect(within(row).queryByText('Unread')).not.toBeInTheDocument())
  // Opening was a step: Back returns to the list.
  router.history.back()
  expect(await screen.findByText('No announcement selected')).toBeInTheDocument()
})

test('without permission to change the platform, nothing is marked and nothing shows unread', async () => {
  const marked = mockApi({ allowWrites: false })
  renderPage(COURSE, '/?post=c1:1')
  expect(await screen.findByRole('heading', { name: 'Midterm room change' })).toBeInTheDocument()
  const row = screen.getByRole('button', { name: /Midterm room change/ })
  expect(within(row).queryByText('Unread')).not.toBeInTheDocument()
  expect(marked).toEqual([])
})

test("a term shows every linked course's announcements and filters by course", async () => {
  mockApi({ allowWrites: false })
  const router = renderPage(TERM)
  expect(await screen.findByRole('button', { name: /Problem set 3 posted/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Midterm room change/ })).toBeInTheDocument()

  await userEvent.click(screen.getByRole('combobox', { name: 'Course' }))
  await userEvent.click(await screen.findByRole('option', { name: /MAT188H1/ }))
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: /Midterm room change/ })).not.toBeInTheDocument(),
  )
  expect(screen.getByRole('button', { name: /Problem set 3 posted/ })).toBeInTheDocument()
  expect(router.state.location.search).toEqual({ course: 'c2' })
})

test('the page is there only where the platform has announcements', () => {
  const data = { items: [link('c1', ['announcements']), link('c2', ['assignments'])] }
  expect(hasAnnouncements(COURSE, data)).toBe(true)
  expect(hasAnnouncements({ ...COURSE, courseId: 'c2' }, data)).toBe(false)
  expect(hasAnnouncements({ ...COURSE, courseId: 'c3' }, data)).toBe(false)
  expect(hasAnnouncements(TERM, data)).toBe(true)
  expect(hasAnnouncements(TERM, { items: [link('c2', ['assignments'])] })).toBe(false)
})

test('the command palette finds announcements by their text and opens them on the page', async () => {
  mockApi({ allowWrites: false })
  const requests: string[] = []
  server.events.on('request:start', ({ request }) => {
    requests.push(new URL(request.url).pathname)
  })
  server.use(
    http.get(`${API}/programs/p1/lms-links`, ({ request }) =>
      HttpResponse.json({
        items: new URL(request.url).searchParams.get('term_id')
          ? [link('c1', ['announcements']), link('c2', ['announcements'])]
          : [link('c1', ['announcements'])],
      }),
    ),
  )
  const queryClient = newQueryClient()
  const search = (query: string, scope: Scope) =>
    announcementSearch.search(query, scope, queryClient)
  const hits = await search('ba1160', COURSE)
  expect(hits).toEqual([
    expect.objectContaining({
      title: 'Midterm room change',
      to: '/p/p1/c/c1/announcements?post=c1%3A1',
    }),
  ])
  // Typing on reads the same list again from the cache.
  await search('midterm', COURSE)
  expect(requests.filter((path) => path.endsWith('/lms/announcements'))).toHaveLength(1)
  // An unlinked course has no page, and nothing is asked of the platform for it.
  expect(await search('welcome', { ...COURSE, courseId: 'c3' })).toEqual([])
  expect(requests).not.toContain('/courses/c3/lms/announcements')
  const termHits = await search('problem set', TERM)
  expect(termHits.map((h) => h.to)).toEqual(['/p/p1/t/t2/announcements?post=c2%3A7'])
  expect(await search('welcome', { kind: 'program', programId: 'p1' })).toEqual([])
  server.events.removeAllListeners()
})
