import type {
  Connection,
  CourseLink,
  ExternalCourse,
  ImportItem,
  ImportSessionDetail,
} from '@semestra/api-client'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest'
import { ItemEditor } from '@/modules/imports/components/ItemEditor'
import { API, apiError, renderWithRouter, server } from '@/test-utils'
import { LmsUpdatesBanner } from './components/LmsUpdatesBanner'
import { groupByTerm } from './external'
import { CoursePicker } from './import/CoursePicker'
import { ConnectionsSection } from './settings/ConnectionsSection'
import { CourseLmsSection } from './settings/CourseLmsSection'
import { ProgramLmsSection } from './settings/ProgramLmsSection'

beforeAll(() => server.listen())
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const PROVIDERS = {
  items: [
    {
      kind: 'canvas',
      display_name: 'Canvas',
      features: ['courses', 'assignments'],
      config_schema: {},
      credentials_schema: {},
    },
  ],
}

function connection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'k1',
    provider: 'canvas',
    display_name: 'U of T Quercus',
    config: { base_url: 'https://q.utoronto.ca' },
    credentials_hint: { access_token: '7~ab…xy' },
    has_credentials: true,
    account_name: 'Ada Student',
    status: 'connected',
    last_checked_at: '2026-09-01T10:00:00Z',
    last_error_code: null,
    program_ids: [],
    link_count: 0,
    created_at: '2026-09-01T10:00:00Z',
    updated_at: '2026-09-01T10:00:00Z',
    ...overrides,
  }
}

function link(overrides: Partial<CourseLink> = {}): CourseLink {
  return {
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
    sync_enabled: true,
    last_synced_at: '2026-09-02T10:00:00Z',
    last_error_code: null,
    created_at: '2026-09-01T10:00:00Z',
    ...overrides,
  }
}

function external(
  overrides: Partial<ExternalCourse> & Pick<ExternalCourse, 'external_id' | 'name'>,
) {
  return {
    code: null,
    term: '2026 Fall',
    is_current: true,
    linked_course_id: null,
    linked_course_name: null,
    ...overrides,
  } as ExternalCourse
}

test('adding a connection sends the form; a rejected token shows and saves nothing', async () => {
  const created = vi.fn<(body: unknown) => void>()
  let saved: Connection[] = []
  server.use(
    http.get(`${API}/lms/providers`, () => HttpResponse.json(PROVIDERS)),
    http.get(`${API}/lms/connections`, () => HttpResponse.json({ items: saved })),
    http.post(`${API}/lms/connections`, async ({ request }) => {
      const body = (await request.json()) as { credentials: { access_token: string } }
      created(body)
      if (body.credentials.access_token === 'wrong-token') {
        const { status, body: error } = apiError('lms.invalid_credentials', 400)
        return HttpResponse.json(error, { status })
      }
      saved = [connection()]
      return HttpResponse.json(saved[0])
    }),
  )
  renderWithRouter(<ConnectionsSection />)
  await userEvent.click(await screen.findByRole('button', { name: 'Add connection' }))
  const dialog = await screen.findByRole('dialog')
  const save = within(dialog).getByRole('button', { name: 'Check and save' })
  expect(save).toBeDisabled()
  await userEvent.type(within(dialog).getByLabelText('Canvas address'), 'q.utoronto.ca')
  await userEvent.type(within(dialog).getByLabelText('API token'), 'wrong-token')
  await userEvent.click(save)
  expect(await within(dialog).findByText('The platform rejected the API token')).toBeInTheDocument()

  await userEvent.clear(within(dialog).getByLabelText('API token'))
  await userEvent.type(within(dialog).getByLabelText('API token'), '7~abcdefghxy')
  await userEvent.click(save)
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(created).toHaveBeenLastCalledWith({
    provider: 'canvas',
    display_name: null,
    config: { base_url: 'q.utoronto.ca' },
    credentials: { access_token: '7~abcdefghxy' },
  })
  expect(await screen.findByText('U of T Quercus')).toBeInTheDocument()
  expect(screen.getByText(/7~ab…xy/)).toBeInTheDocument()
  expect(screen.queryByText(/abcdefgh/)).toBeNull()
})

test('deleting a connection in use says what it unlinks and detaches everything', async () => {
  const removed = vi.fn<(url: string) => void>()
  server.use(
    http.get(`${API}/lms/providers`, () => HttpResponse.json(PROVIDERS)),
    http.get(`${API}/lms/connections`, () =>
      HttpResponse.json({ items: [connection({ program_ids: ['p1'], link_count: 3 })] }),
    ),
    http.delete(`${API}/lms/connections/k1`, ({ request }) => {
      removed(request.url)
      return HttpResponse.json({ id: 'k1', unbound_programs: 1, unlinked_courses: 3 })
    }),
  )
  renderWithRouter(<ConnectionsSection />)
  await userEvent.click(await screen.findByRole('button', { name: 'Delete U of T Quercus' }))
  const confirm = await screen.findByRole('alertdialog')
  expect(within(confirm).getByText(/also removes 3 course links/)).toBeInTheDocument()
  await userEvent.click(within(confirm).getByRole('button', { name: 'Delete' }))
  await waitFor(() => expect(removed).toHaveBeenCalled())
  expect(removed.mock.calls[0]?.[0]).toContain('detach_all=true')
})

test("a program's connection is locked while courses are linked through it", async () => {
  server.use(
    http.get(`${API}/lms/connections`, () => HttpResponse.json({ items: [connection()] })),
    http.get(`${API}/programs/p1/lms-binding`, () =>
      HttpResponse.json({
        program_id: 'p1',
        connection_id: 'k1',
        connection: connection(),
        link_count: 2,
      }),
    ),
  )
  renderWithRouter(<ProgramLmsSection scope={{ kind: 'program', programId: 'p1' }} />)
  expect(
    await screen.findByText(/2 courses are linked through this connection/),
  ).toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: 'Connection' })).toBeDisabled()
})

test('course settings: guidance without a binding, then sync switch and unlink', async () => {
  const scope = { kind: 'course', programId: 'p1', courseId: 'c1' } as const
  server.use(
    http.get(`${API}/courses/c1/lms-link`, () =>
      HttpResponse.json({ course_id: 'c1', link: null, program_connection_id: null }),
    ),
  )
  const first = renderWithRouter(<CourseLmsSection scope={scope} />)
  expect(await screen.findByText('No LMS connection for this program')).toBeInTheDocument()
  first.unmount()

  const patched = vi.fn<(body: unknown) => void>()
  const deleted = vi.fn<() => void>()
  server.use(
    http.get(`${API}/courses/c1/lms-link`, () =>
      HttpResponse.json({ course_id: 'c1', link: link(), program_connection_id: 'k1' }),
    ),
    http.patch(`${API}/courses/c1/lms-link`, async ({ request }) => {
      patched(await request.json())
      return HttpResponse.json({ course_id: 'c1', link: link(), program_connection_id: 'k1' })
    }),
    http.delete(`${API}/courses/c1/lms-link`, () => {
      deleted()
      return HttpResponse.json({ course_id: 'c1', link: null, program_connection_id: 'k1' })
    }),
  )
  renderWithRouter(<CourseLmsSection scope={scope} />)
  expect(await screen.findByText('APS105H1 · Computer Fundamentals')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Open in Canvas' })).toHaveAttribute(
    'href',
    'https://q.utoronto.ca/courses/101',
  )
  await userEvent.click(screen.getByRole('switch', { name: 'Sync' }))
  await waitFor(() => expect(patched).toHaveBeenCalledWith({ sync_enabled: false }))
  await userEvent.click(screen.getByRole('button', { name: 'Unlink' }))
  const confirm = await screen.findByRole('alertdialog')
  await userEvent.click(within(confirm).getByRole('button', { name: 'Unlink' }))
  await waitFor(() => expect(deleted).toHaveBeenCalled())
})

test('external courses group by term, current terms first', () => {
  const groups = groupByTerm([
    external({ external_id: '1', name: 'Old', term: '2025 Fall', is_current: false }),
    external({ external_id: '2', name: 'Now', term: '2026 Fall' }),
    external({ external_id: '3', name: 'Sandbox', term: null, is_current: false }),
  ])
  expect(groups.map((g) => g.term)).toEqual(['2026 Fall', '2025 Fall', 'No term'])
})

test('the course picker skips linked courses and starts an import into the term', async () => {
  const started = vi.fn<(body: unknown) => void>()
  server.use(
    http.get(`${API}/programs/p1/lms-binding`, () =>
      HttpResponse.json({ program_id: 'p1', connection_id: 'k1', connection: null, link_count: 1 }),
    ),
    http.get(`${API}/programs/p1/lms/courses`, () =>
      HttpResponse.json({
        connection_id: 'k1',
        provider: 'canvas',
        truncated: false,
        items: [
          external({ external_id: '101', code: 'APS105H1', name: 'Computer Fundamentals' }),
          external({
            external_id: '102',
            code: 'MAT188H1',
            name: 'Linear Algebra',
            linked_course_id: 'c9',
            linked_course_name: 'MAT188',
          }),
        ],
      }),
    ),
    http.post(`${API}/programs/p1/lms/imports:courses`, async ({ request }) => {
      started(await request.json())
      return HttpResponse.json({ session_id: 's1', program_id: 'p1', count: 1 })
    }),
    http.get(`${API}/imports/s1`, () => HttpResponse.json({ id: 's1', items: [] })),
  )
  const onStarted = vi.fn<(session: ImportSessionDetail) => void>()
  renderWithRouter(<CoursePicker programId="p1" target={{ termId: 't1' }} onStarted={onStarted} />)
  expect(await screen.findByRole('checkbox', { name: /Linear Algebra/ })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
  expect(screen.getByText('Linked to MAT188')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('checkbox', { name: /Computer Fundamentals/ }))
  await userEvent.click(screen.getByRole('button', { name: 'Review 1' }))
  await waitFor(() => expect(onStarted).toHaveBeenCalled())
  expect(started).toHaveBeenCalledWith({ external_course_ids: ['101'], term_id: 't1' })
})

test('the updates banner shows changed assignments of a synced course', async () => {
  server.use(
    http.get(`${API}/courses/c1/lms-link`, () =>
      HttpResponse.json({ course_id: 'c1', link: link(), program_connection_id: 'k1' }),
    ),
    http.get(`${API}/courses/c1/lms/updates`, () =>
      HttpResponse.json({
        course_id: 'c1',
        count: 2,
        items: [
          {
            external_id: '1',
            name: 'Lab 1',
            target: { kind: 'assessment', id: 'a1' },
            changes: {},
          },
          { external_id: '2', name: 'Quiz 2', target: { kind: 'task', id: 't1' }, changes: {} },
        ],
      }),
    ),
  )
  renderWithRouter(<LmsUpdatesBanner programId="p1" courseId="c1" />)
  expect(await screen.findByText('2 imported assignments changed on Canvas')).toBeInTheDocument()
  expect(screen.getByText('Lab 1 · Quiz 2')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Review changes' })).toBeInTheDocument()
})

function importItem(
  overrides: Partial<ImportItem> & Pick<ImportItem, 'type' | 'data'>,
): ImportItem {
  return {
    id: 'i1',
    session_id: 's1',
    evidence: {},
    confidence: {},
    decision: 'accept',
    issues: [],
    depends_on: [],
    result: null,
    position: 0,
    ...overrides,
  }
}

test('an LMS assignment can switch between assessment and task in the review', async () => {
  const patched = vi.fn<(body: unknown) => void>()
  server.use(
    http.patch(`${API}/imports/s1/items/i1`, async ({ request }) => {
      patched(await request.json())
      return HttpResponse.json({ id: 's1', items: [] })
    }),
  )
  renderWithRouter(
    <ItemEditor
      item={importItem({ type: 'assessment', data: { course_ref: 'course:c1', title: 'Lab 1' } })}
      editable
    />,
  )
  await userEvent.click(await screen.findByRole('button', { name: 'Task' }))
  await waitFor(() => expect(patched).toHaveBeenCalledWith({ type: 'task' }))
})

test('a changed assignment shows its name and old → new values', async () => {
  renderWithRouter(
    <ItemEditor
      item={importItem({
        type: 'assessment_patch',
        data: {
          assessment_id: 'a1',
          label: 'Lab 1',
          changes: { due_date: { old: '2026-02-07', new: '2026-02-12' } },
        },
      })}
      editable
    />,
  )
  expect(await screen.findByRole('heading', { name: 'Lab 1' })).toBeInTheDocument()
  expect(screen.getByText('Assessment change')).toBeInTheDocument()
  expect(screen.getByText('2026-02-07')).toBeInTheDocument()
  expect(screen.getByText('2026-02-12')).toBeInTheDocument()
})
