import type { CourseAnnouncement, CourseLink } from '@semestra/api-client'
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
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest'
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

function post(id: string, overrides: Partial<CourseAnnouncement> = {}): CourseAnnouncement {
  return {
    external_id: id,
    course_id: 'c1',
    web_url: `https://q.utoronto.ca/courses/101/discussion_topics/${id}`,
    title: `Post ${id}`,
    html: `<p>Body of ${id}</p>`,
    text: `Body of ${id}`,
    author: 'Prof. Lee',
    posted_at: '2026-02-10T15:00:00Z',
    updated_at: null,
    unread: false,
    attachments: [],
    targets: [],
    ...overrides,
  }
}

const COURSE_POSTS = [
  post('1', {
    title: 'Midterm room change',
    html: '<p>We moved to <b>BA1160</b>.</p>',
    text: 'We moved to BA1160.',
    unread: true,
  }),
  post('2', { title: 'Welcome', posted_at: '2026-01-06T15:00:00Z' }),
]
const TERM_POSTS = [COURSE_POSTS[0]!, post('7', { title: 'Problem set 3 posted', course_id: 'c2' })]

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
    synced_at: null,
    sync_state: 'ok',
    features,
    created_at: '2026-01-01T00:00:00Z',
  }
}

function mockApi({
  posts = COURSE_POSTS,
  notRead = null as string | null,
  display = 'simplified',
} = {}) {
  const marked: string[] = []
  server.use(
    http.get(`${API}/me/settings/lms`, () =>
      HttpResponse.json({
        namespace: 'lms',
        scope_type: 'account',
        scope_id: null,
        values: { display },
        sources: {},
        inherited: {},
      }),
    ),
    ...academicsHandlers(defaultWorld()),
    http.get(`${API}/courses/:id/lms/announcements`, () =>
      HttpResponse.json({ items: posts, not_read: notRead }),
    ),
    http.get(`${API}/terms/:id/lms/announcements`, () =>
      HttpResponse.json({ items: TERM_POSTS, linked_course_ids: ['c1', 'c2'], not_read: null }),
    ),
    http.post(`${API}/courses/:course/lms/announcements/:id\\:read`, ({ params }) => {
      marked.push(`${params.course}:${params.id}`)
      const found = posts.find((p) => p.external_id === params.id)!
      return HttpResponse.json({ ...found, unread: false })
    }),
    http.get(`${API}/programs/:id/lms/announcements/unread`, () =>
      HttpResponse.json({ items: [] }),
    ),
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

test('nothing opens by itself; opening an unread one marks it read', async () => {
  const marked = mockApi()
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

test('links and attachments open what Semestra has, the rest go to the platform', async () => {
  const file = { kind: 'file' as const, id: 'f1', course_id: 'c1', folder_id: 'd1' }
  mockApi({
    posts: [
      post('1', {
        title: 'Lab 1 is out',
        html:
          '<p><a href="https://q/files/77" data-lms-kind="file" data-lms-ref="77">notes</a> ' +
          '<a href="https://q/assignments/5" data-lms-kind="assignment" data-lms-ref="5">lab</a> ' +
          '<a href="https://q/pages/x" data-lms-kind="page" data-lms-ref="x">page</a> ' +
          '<a href="https://q/files/99" data-lms-kind="file" data-lms-ref="99">handout</a> ' +
          '<a href="https://piazza.com/class/aps105">forum</a></p>',
        targets: [
          { kind: 'file', ref: '77', target: file },
          {
            kind: 'assignment',
            ref: '5',
            target: { kind: 'assessment', id: 'a1', course_id: 'c1', folder_id: null },
          },
        ],
        attachments: [
          {
            external_id: '77',
            name: 'Notes.pdf',
            mime_type: 'application/pdf',
            size_bytes: 2048,
            file,
          },
          { external_id: '88', name: 'Rubric.pdf', mime_type: null, size_bytes: null, file: null },
        ],
      }),
    ],
  })
  const router = renderPage(COURSE, '/?post=c1:1')
  expect(await screen.findByRole('heading', { name: 'Lab 1 is out' })).toBeInTheDocument()
  expect(await screen.findByRole('button', { name: 'Open in Canvas' })).toHaveAttribute(
    'href',
    'https://q.utoronto.ca/courses/101/discussion_topics/1',
  )

  expect(screen.getByText('2 attachments')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /Notes\.pdf/ })).toHaveAttribute(
    'href',
    '/p/p1/c/c1/files?folder=d1&file=f1',
  )
  expect(screen.getByRole('link', { name: /Rubric\.pdf/ })).toHaveAttribute(
    'href',
    `${API}/courses/c1/lms/files/88/content`,
  )

  // Without a counterpart the link stays the platform's own; a file still opens through Semestra.
  expect(screen.getByRole('link', { name: 'page' })).toHaveAttribute('href', 'https://q/pages/x')
  const opened = vi.spyOn(window, 'open').mockReturnValue(null)
  await userEvent.click(screen.getByRole('link', { name: 'handout' }))
  expect(opened).toHaveBeenCalledWith(
    `${API}/courses/c1/lms/files/99/content`,
    '_blank',
    'noopener,noreferrer',
  )
  opened.mockRestore()
  // An assignment opens its details over the page.
  await userEvent.click(screen.getByRole('link', { name: 'lab' }))
  await waitFor(() => expect(router.state.location.search).toMatchObject({ assignment: 'c1:5' }))
  // A link to another site asks first, as links elsewhere in the app do.
  await userEvent.click(await screen.findByRole('link', { name: 'forum' }))
  const leave = await screen.findByRole('alertdialog', { name: 'Open an external site?' })
  expect(leave).toHaveTextContent('https://piazza.com/class/aps105')
  await userEvent.click(within(leave).getByRole('button', { name: 'Cancel' }))
  await userEvent.click(await screen.findByRole('link', { name: 'notes' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/p/p1/c/c1/files'))
})

test("a course the sync hasn't read says why, and an ended term's course can be read now", async () => {
  mockApi({ posts: [], notRead: 'ended' })
  const synced: unknown[] = []
  server.use(
    http.post(`${API}/programs/p1/lms/sync`, async ({ request }) => {
      synced.push(await request.json())
      return HttpResponse.json({ queued: 1 })
    }),
  )
  renderPage(COURSE)
  expect(await screen.findByText("Announcements haven't synced yet")).toBeInTheDocument()
  expect(
    screen.getByText("This course's term has ended, so it no longer syncs on its own."),
  ).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Sync now' }))
  await waitFor(() => expect(synced).toEqual([{ course_id: 'c1', force: true }]))
})

test("a term shows every linked course's announcements and filters by course", async () => {
  mockApi()
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
  mockApi()
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

test('the display follows the account setting and a pick stays for the next announcement', async () => {
  mockApi({
    display: 'original',
    posts: [
      post('1', {
        title: 'First',
        html: '<p style="color: rgb(0, 42, 92)">One</p>',
        text: 'One',
      }),
      post('2', {
        title: 'Second',
        html: '<p style="color: rgb(0, 42, 92)">Two</p>',
        text: 'Two',
      }),
    ],
  })
  renderPage(COURSE, '/?post=c1:1')
  await screen.findByRole('heading', { name: 'First' })
  const article = () => screen.getByRole('article')
  await waitFor(() =>
    expect(within(article()).getByText('One')).toHaveAttribute('style', 'color: rgb(0, 42, 92)'),
  )
  await userEvent.click(screen.getByRole('button', { name: 'Display: Canvas style' }))
  await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Simplified' }))
  await waitFor(() => expect(within(article()).getByText('One')).not.toHaveAttribute('style'))
  await userEvent.click(screen.getByRole('button', { name: /Second/ }))
  expect(await within(article()).findByText('Two')).not.toHaveAttribute('style')
})
