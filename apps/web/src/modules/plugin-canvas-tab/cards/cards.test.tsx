import type { CourseLink, CourseOverview, NavTab } from '@semestra/api-client'
import { screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest'
import type { CardProps } from '@/app/extensions'
import { course } from '@/modules/academics/test-data'
import { API, renderWithRouter, server } from '@/test-utils'
import ShortcutCard from './ShortcutCard'
import ShortcutsCard from './ShortcutsCard'

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function tab(kind: NavTab['kind'], label: string, position: number, hidden = false): NavTab {
  return { external_id: `${kind}-${position}`, web_url: null, kind, label, position, hidden }
}

const FULL_MENU: NavTab[] = [
  tab('home', 'Home', 1),
  tab('announcements', 'Announcements', 2),
  tab('modules', 'Modules', 3),
  tab('assignments', 'Assignments', 4),
  tab('discussions', 'Discussions', 5),
  tab('files', 'Files', 6),
  tab('syllabus', 'Syllabus', 7, true),
  tab('external', 'Piazza', 8),
]

function link(courseId: string): CourseLink {
  return {
    id: `l-${courseId}`,
    course_id: courseId,
    program_id: 'p1',
    connection_id: 'k1',
    provider: 'canvas',
    external_course_id: courseId,
    features: [],
    external_code: null,
    external_name: null,
    external_term: null,
    web_url: null,
    sync_enabled: true,
    synced_at: null,
    sync_state: 'ok',
    created_at: '2026-09-01T10:00:00Z',
  }
}

function overview(courseId: string, navigation: NavTab[]): CourseOverview {
  return {
    link: link(courseId),
    provider: 'canvas',
    provider_name: 'Canvas',
    features: ['navigation'],
    course: { external_id: courseId, name: courseId, code: courseId, term: null },
    navigation,
    default_view: 'modules',
    truncated: false,
  }
}

/** `linked`: course ids linked to Canvas, each with its menu. */
function serve(linked: Record<string, NavTab[]>, unread: Record<string, number> = {}) {
  server.use(
    http.get(`${API}/programs/p1/lms-links`, () =>
      HttpResponse.json({ items: Object.keys(linked).map(link) }),
    ),
    http.get(`${API}/courses/:courseId/lms`, ({ params }) =>
      HttpResponse.json(overview(String(params.courseId), linked[String(params.courseId)] ?? [])),
    ),
    http.get(`${API}/programs/p1/lms/announcements/unread`, () =>
      HttpResponse.json({
        items: Object.entries(unread).map(([course_id, n]) => ({ course_id, unread: n })),
      }),
    ),
  )
}

const ON_COURSE: CardProps = {
  scope: { kind: 'course', programId: 'p1', courseId: 'c1' },
  size: 'm',
  instanceId: 'i1',
  settings: {},
}

test("the course card opens each of the Canvas tab's views, in the course's menu order", async () => {
  serve({ c1: FULL_MENU }, { c1: 3 })
  renderWithRouter(<ShortcutsCard {...ON_COURSE} />)
  const links = await screen.findAllByRole('link')
  // Discussions open only in Canvas, Piazza is on the course info card, Syllabus is hidden.
  expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
    ['Home', '/p/p1/c/c1/canvas?tab=home'],
    [expect.stringContaining('Announcements'), '/p/p1/c/c1/canvas?tab=announcements'],
    ['Modules', '/p/p1/c/c1/canvas?tab=modules'],
    ['Assignments & grades', '/p/p1/c/c1/canvas?tab=assignments'],
    ['Files', '/p/p1/c/c1/canvas?tab=files'],
  ])
  expect(within(links[1]!).getByText('3')).toBeInTheDocument()
})

test('the course card says when the course is not linked to Canvas', async () => {
  serve({})
  renderWithRouter(<ShortcutsCard {...ON_COURSE} />)
  expect(await screen.findByText('Not linked to Canvas')).toBeInTheDocument()
})

test('the term card has a row per linked course, with its views in the same columns', async () => {
  serve(
    { c1: FULL_MENU, c2: [tab('announcements', 'Announcements', 1), tab('pages', 'Pages', 2)] },
    { c2: 1 },
  )
  server.use(
    http.get(`${API}/programs/p1/courses`, () =>
      HttpResponse.json({
        items: [
          course({ id: 'c1', code: 'ECE201', term_ids: ['t1'] }),
          course({ id: 'c2', code: 'MAT290', term_ids: ['t1'] }),
          course({ id: 'c3', code: 'APS100', term_ids: ['t1'] }),
        ],
        next_cursor: null,
      }),
    ),
  )
  renderWithRouter(
    <ShortcutsCard {...ON_COURSE} scope={{ kind: 'term', programId: 'p1', termId: 't1' }} />,
  )
  const rows = await screen.findAllByRole('listitem')
  // APS100 is not linked.
  expect(rows).toHaveLength(2)
  expect(within(rows[0]!).getByRole('link', { name: 'ECE201' })).toHaveAttribute(
    'href',
    '/p/p1/c/c1/canvas',
  )
  expect(await within(rows[1]!).findByRole('link', { name: /Pages/ })).toHaveAttribute(
    'href',
    '/p/p1/c/c2/canvas?tab=pages',
  )
  expect(within(rows[1]!).queryByRole('link', { name: /Modules/ })).toBeNull()
  expect(within(rows[1]!).getByRole('link', { name: /Announcements/ })).toHaveTextContent('1')
  // Each row keeps all six places: the Pages icon is in the same column in both rows.
  const column = (row: HTMLElement) => [...row.lastElementChild!.children].findIndex((el) =>
    el.getAttribute('aria-label')?.endsWith('Pages'),
  )
  await within(rows[0]!).findByRole('link', { name: /Modules/ })
  expect(column(rows[1]!)).toBe(4)
})

test("the single shortcut opens the chosen view under the course's own name", async () => {
  serve({ c1: [tab('modules', 'Weekly modules', 1)] })
  renderWithRouter(<ShortcutCard {...ON_COURSE} size="s" settings={{ place: 'modules' }} />)
  expect(await screen.findByRole('link', { name: 'Weekly modules' })).toHaveAttribute(
    'href',
    '/p/p1/c/c1/canvas?tab=modules',
  )
})

test('the single shortcut set to the last place opens the tab where the user left it', async () => {
  serve({ c1: FULL_MENU })
  renderWithRouter(<ShortcutCard {...ON_COURSE} size="s" settings={{ place: 'last' }} />)
  expect(await screen.findByRole('link', { name: 'Canvas' })).toHaveAttribute(
    'href',
    '/p/p1/c/c1/canvas',
  )
})
