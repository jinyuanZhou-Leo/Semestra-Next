import type {
  SyncItem,
  SyncMaterialChange,
  SyncProblem,
  SyncStatus,
  SyncUnreadable,
} from '@semestra/api-client'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest'
import { API, renderWithRouter, server } from '@/test-utils'
import { Popover, PopoverContent } from '@/ui/popover'
import SyncPanel from './SyncPanel'
import { AssessmentDialog } from '@/modules/grading/components/AssessmentDialog'
import { assessment } from '@/modules/grading/test-data'
import { SyncOnOpen } from './SyncOnOpen'
import SyncSection from '../mobile/SyncSection'

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const IN_PROGRAM = { path: '/p/$programId', at: '/p/p1' }

/** The panel where the status line shows it. */
function InPopover() {
  return (
    <Popover open>
      <PopoverContent>
        <SyncPanel onClose={() => undefined} />
      </PopoverContent>
    </Popover>
  )
}

function item(overrides: Partial<SyncItem> & Pick<SyncItem, 'id' | 'title'>): SyncItem {
  return {
    course_id: 'c1',
    course: 'CSC148',
    kind: 'new',
    external_id: overrides.id,
    due_at: null,
    conflicts: [],
    ...overrides,
  }
}

function status(overrides: Partial<SyncStatus> = {}): SyncStatus {
  return {
    program_id: 'p1',
    provider: 'canvas',
    connection_name: 'U of T Quercus',
    connection_error: null,
    every: '6h',
    courses: 2,
    synced_at: new Date().toISOString(),
    syncing: false,
    pending: [],
    ignored: [],
    recent: [],
    different: [],
    materials: [],
    removed_materials: [],
    removed_count: 0,
    unreadable: [],
    calendar_waiting: 0,
    calendar_unreadable: 0,
    problems: [],
    ...overrides,
  }
}

function handlers(current: SyncStatus) {
  return [
    http.get(`${API}/programs/p1/lms/sync`, () => HttpResponse.json(current)),
    http.get(`${API}/lms/providers`, () =>
      HttpResponse.json({
        items: [
          {
            kind: 'canvas',
            display_name: 'Canvas',
            features: [],
            config_schema: {},
            credentials_schema: {},
            sign_in: false,
          },
        ],
      }),
    ),
    http.post(`${API}/me/ui-state\\:get`, () => HttpResponse.json({ items: {} })),
    http.put(`${API}/me/ui-state/:key`, () => HttpResponse.json({ ok: true })),
    http.get(`${API}/programs/p1/courses`, () =>
      HttpResponse.json({ items: [], next_cursor: null }),
    ),
  ]
}

test('opening a Program syncs it; new assignments wait in the panel and can be ignored', async () => {
  const current = status({
    pending: [item({ id: 'r1', title: 'A3' }), item({ id: 'r2', title: 'Lab 9' })],
  })
  const requested = vi.fn<(body: unknown) => void>()
  const dismissed = vi.fn<(body: unknown) => void>()
  server.use(
    ...handlers(current),
    http.post(`${API}/programs/p1/lms/sync`, async ({ request }) => {
      requested(await request.json())
      return HttpResponse.json({ queued: 0 })
    }),
    http.post(`${API}/programs/p1/lms/sync\\:dismiss`, async ({ request }) => {
      dismissed(await request.json())
      return HttpResponse.json(status({ ignored: current.pending }))
    }),
  )
  renderWithRouter(
    <>
      <SyncOnOpen />
      <InPopover />
    </>,
    undefined,
    IN_PROGRAM,
  )
  expect(await screen.findByText('A3')).toBeInTheDocument()
  expect(screen.getByText('Lab 9')).toBeInTheDocument()
  await waitFor(() => expect(requested).toHaveBeenCalledWith({}))
  await userEvent.click(screen.getAllByRole('button', { name: 'Ignore' })[0]!)
  await waitFor(() =>
    expect(dismissed).toHaveBeenCalledWith({ assignment_ids: ['r1'], dismissed: true }),
  )
})

test('a value changed on both sides is settled from the panel', async () => {
  const conflict = item({
    id: 'r1',
    title: 'A3',
    kind: 'conflict',
    conflicts: [
      { field: 'title', mine: 'A3', platform: 'A3 (revised)', edited: false },
      { field: 'weight', mine: 10, platform: 15, edited: true },
    ],
  })
  const resolved = vi.fn<(body: unknown) => void>()
  server.use(
    ...handlers(status({ pending: [conflict] })),
    http.post(`${API}/lms/sync/items/r1/fields/weight\\:resolve`, async ({ request }) => {
      resolved(await request.json())
      return HttpResponse.json(status())
    }),
  )
  renderWithRouter(<InPopover />, undefined, IN_PROGRAM)
  expect(await screen.findByText(/You changed this/)).toBeInTheDocument()
  // One row, and one answer counted, per field.
  expect(screen.getByRole('heading', { name: /^To review\s*2$/ })).toBeInTheDocument()
  await userEvent.click(screen.getAllByRole('button', { name: 'Keep' })[1]!)
  await waitFor(() => expect(resolved).toHaveBeenCalledWith({ choice: 'mine' }))
  // Folded away, then gone.
  await waitFor(() => expect(screen.queryByText('To review')).not.toBeInTheDocument())
})

test('a change the sync made is undone from the panel, and so is undoing it', async () => {
  const change = {
    id: 'ch1',
    kind: 'field' as const,
    course_id: 'c1',
    course: 'CSC148',
    title: 'A3',
    field: 'title',
    old: 'A3',
    new: 'A3 (revised)',
    at: new Date().toISOString(),
    reverted: false,
    toggleable: true,
    target_kind: 'assessment' as const,
    external_id: 'a1',
    target_id: 'as1',
  }
  const calls = vi.fn<(url: string) => void>()
  server.use(
    ...handlers(status({ recent: [change] })),
    http.post(`${API}/lms/sync/changes/ch1\\:revert`, ({ request }) => {
      calls(request.url)
      return HttpResponse.json(status({ recent: [{ ...change, reverted: true }] }))
    }),
    http.post(`${API}/lms/sync/changes/ch1\\:reapply`, ({ request }) => {
      calls(request.url)
      return HttpResponse.json(status({ recent: [change] }))
    }),
  )
  renderWithRouter(<InPopover />, undefined, IN_PROGRAM)
  await userEvent.click(await screen.findByRole('button', { name: 'Undo' }))
  expect(await screen.findByText('Undone')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Redo' }))
  await waitFor(() => expect(screen.queryByText('Undone')).not.toBeInTheDocument())
  expect(calls.mock.calls.map(([url]) => url.split(':').at(-1))).toEqual(['revert', 'reapply'])
})

test('materials the platform changed open from the panel; ones the user removed come back', async () => {
  const at = new Date().toISOString()
  const material = (id: string, title: string, change: SyncMaterialChange['change']) => ({
    id,
    course_id: 'c1',
    course: 'CSC148',
    title,
    change,
    at,
    item_id: change === 'gone' ? null : `item-${id}`,
    folder_id: change === 'gone' ? null : 'f1',
    folder: change === 'gone' ? null : 'Lecture slides',
  })
  const restored = vi.fn<(url: string) => void>()
  const removed = { id: 'm9', course_id: 'c1', course: 'CSC148', title: 'Old notes.pdf', at }
  server.use(
    ...handlers(
      status({
        materials: [
          material('m1', 'Week 3.pdf', 'added'),
          material('m2', 'Syllabus', 'updated'),
          material('m3', 'Midterm.pdf', 'gone'),
          material('m4', 'Rubric.pdf', 'handed_over'),
        ],
        removed_materials: [removed],
        removed_count: 1,
      }),
    ),
    http.post(`${API}/lms/sync/materials/m9\\:restore`, ({ request }) => {
      restored(request.url)
      return HttpResponse.json(status())
    }),
  )
  renderWithRouter(<InPopover />, undefined, IN_PROGRAM)
  // A material still in the course's files opens there, in its folder.
  const added = await screen.findByRole('link', { name: /^Week 3\.pdf/ })
  expect(added).toHaveAttribute('href', '/p/p1/c/c1/files?folder=f1&file=item-m1')
  expect(within(added).getByText('Lecture slides')).toBeInTheDocument() // where it is now
  expect(screen.getByRole('link', { name: /^Rubric\.pdf/ })).toBeInTheDocument()
  expect(screen.getByText('Deleted on Canvas; your saved file stays')).toBeInTheDocument()
  // One gone with the platform has nothing to open.
  expect(screen.queryByRole('link', { name: /^Midterm\.pdf/ })).not.toBeInTheDocument()
  expect(screen.getByText('Deleted on Canvas')).toBeInTheDocument()

  await userEvent.click(screen.getByRole('button', { name: /^Removed materials\s*1$/ }))
  expect(await screen.findByText('Old notes.pdf')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Restore' }))
  await waitFor(() => expect(restored).toHaveBeenCalled())
  await waitFor(() => expect(screen.queryByText('Old notes.pdf')).not.toBeInTheDocument())
})

test('every removed material is restored at once, also those past the listed rows', async () => {
  const at = new Date().toISOString()
  const removed = (id: string, title: string) => ({
    id,
    course_id: 'c1',
    course: 'CSC148',
    title,
    at,
  })
  const restoredAll = vi.fn<(url: string) => void>()
  server.use(
    ...handlers(
      status({
        removed_materials: [removed('m1', 'Old notes.pdf'), removed('m2', 'Week 1')],
        removed_count: 60,
      }),
    ),
    http.post(`${API}/programs/p1/lms/sync/materials\\:restore`, ({ request }) => {
      restoredAll(request.url)
      return HttpResponse.json(status())
    }),
  )
  renderWithRouter(<InPopover />, undefined, IN_PROGRAM)
  // There while the list is folded.
  await userEvent.click(await screen.findByRole('button', { name: 'Restore all' }))
  await waitFor(() => expect(restoredAll).toHaveBeenCalledOnce())
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: /^Removed materials/ })).not.toBeInTheDocument(),
  )
})

const UNREAD = {
  course_id: 'c1',
  course: 'CSC148',
  id: null,
  parts: [],
  area: null,
  title: null,
  count: 0,
  code: null,
  params: {},
  since: null,
  item_id: null,
  external_id: null,
  removable: false,
} satisfies Omit<SyncUnreadable, 'kind'>

const PROBLEM = {
  course_id: 'c1',
  course: 'CSC148',
  stage: 'assignments',
  ended: false,
  code: 'common.internal',
  request_id: 'req-1',
  items: [],
  reads: [],
} satisfies SyncProblem

// One per row of M09 表 5c the panel lists: what it shows (title, then the detail after the
// course), and in which list.
const ROWS: [string, Partial<SyncStatus>, string, string, 'Sync errors' | 'Not updated'][] = [
  [
    '2: the course not synced',
    { problems: [{ ...PROBLEM, stage: 'course', ended: true }] },
    'CSC148',
    'Course not synced',
    'Sync errors',
  ],
  ['3: a stage not synced', { problems: [PROBLEM] }, 'Assignments', 'Not synced', 'Sync errors'],
  [
    '4: items not synced',
    {
      problems: [
        {
          ...PROBLEM,
          items: [
            { kind: 'assignment', external_id: 'a4', title: 'Lab 4' },
            { kind: 'assignment', external_id: 'a5', title: 'Quiz 3' },
          ],
        },
      ],
    },
    'Lab 4, Quiz 3',
    'Assignments not synced: 2',
    'Sync errors',
  ],
  [
    '4: parts not read',
    { problems: [{ ...PROBLEM, reads: ['submissions'] }] },
    'Submissions and feedback',
    'Not synced',
    'Sync errors',
  ],
  [
    '5: the course refused',
    { unreadable: [{ ...UNREAD, kind: 'parts', parts: ['course'], code: 'lms.forbidden' }] },
    'CSC148',
    'Course not accessible · Not synced yet',
    'Not updated',
  ],
  [
    '6: parts the platform did not answer for',
    {
      unreadable: [
        {
          ...UNREAD,
          kind: 'parts',
          parts: ['submissions', 'total'],
          code: 'lms.unreachable',
          since: '2026-11-20T14:20:00Z',
        },
      ],
    },
    'Submissions and feedback, Course total',
    'Canvas not responding · Updated Nov 20',
    'Not updated',
  ],
  [
    '6: an answer not understood',
    {
      unreadable: [
        {
          ...UNREAD,
          kind: 'parts',
          parts: ['announcements'],
          code: 'lms.unreachable',
          params: { reason: 'payload' },
        },
      ],
    },
    'Announcements',
    'Unrecognized response from Canvas · Not synced yet',
    'Not updated',
  ],
  [
    '6: a rate limit',
    { unreadable: [{ ...UNREAD, kind: 'parts', parts: ['calendar'], code: 'lms.rate_limited' }] },
    'Calendar',
    'Canvas rate limit · Not synced yet',
    'Not updated',
  ],
  [
    '7: a part refused',
    { unreadable: [{ ...UNREAD, kind: 'parts', parts: ['pages'], code: 'lms.forbidden' }] },
    'Pages',
    'No access · Not synced yet',
    'Not updated',
  ],
  [
    '8: an area closed',
    {
      unreadable: [
        {
          ...UNREAD,
          kind: 'area',
          area: 'files',
          code: 'lms.area_hidden',
          since: '2026-11-20T14:20:00Z',
        },
      ],
    },
    'Files',
    'Section closed · Updated Nov 20',
    'Not updated',
  ],
  [
    '9: an item refused',
    {
      unreadable: [
        {
          ...UNREAD,
          kind: 'material',
          id: 'm1',
          area: 'files',
          title: 'Notes.pdf',
          code: 'lms.forbidden',
          since: '2026-11-21T09:00:00Z',
        },
      ],
    },
    'Notes.pdf',
    'No access · Since Nov 21',
    'Not updated',
  ],
]

test.each(ROWS)('table 5c row %s', async (_, overrides, title, detail, list) => {
  vi.useFakeTimers({ now: new Date('2026-11-24T12:00:00Z'), shouldAdvanceTime: true })
  server.use(...handlers(status(overrides)))
  renderWithRouter(<InPopover />, undefined, IN_PROGRAM)
  const toggle = await screen.findByRole('button', { name: new RegExp(`^${list}\\s*1$`) })
  // Errors are open as the panel opens: not something to look for.
  const open = toggle.getAttribute('aria-expanded') === 'true'
  expect(open).toBe(list === 'Sync errors')
  if (!open) await userEvent.click(toggle)
  expect(await screen.findByText(title)).toBeInTheDocument()
  expect(screen.getByText(detail)).toBeInTheDocument()
  // A closed area is the teacher's setting, not out of date (row 8).
  const partly = !overrides.unreadable?.every((u) => u.kind === 'area')
  expect(screen.queryByText(/Some content not updated/) !== null).toBe(partly)
  vi.useRealTimers()
})

test('an error row copies its error ID', async () => {
  const user = userEvent.setup()
  server.use(...handlers(status({ problems: [PROBLEM] })))
  renderWithRouter(<InPopover />, undefined, IN_PROGRAM)
  await user.click(await screen.findByRole('button', { name: 'Copy error ID' }))
  // oxlint-disable-next-line no-restricted-properties -- reads back what user-event's clipboard got
  expect(await navigator.clipboard.readText()).toBe('req-1')
})

test('an item of a closed area goes under its row; only materials read online can be removed', async () => {
  const removed = vi.fn<(url: string) => void>()
  const closed = { ...UNREAD, area: 'files', code: 'lms.area_hidden' }
  const listed = status({
    unreadable: [
      { ...closed, kind: 'area' },
      { ...closed, kind: 'material', id: 'm1', title: 'Week 3.pdf', item_id: 'i1' },
      {
        ...closed,
        kind: 'material',
        id: 'm2',
        title: 'Rubric.pdf',
        item_id: 'i2',
        removable: true,
      },
      { ...closed, kind: 'material', id: 'm3', title: 'Notes.pdf', item_id: 'i3', removable: true },
      { ...UNREAD, kind: 'area', area: 'announcements', code: 'lms.area_hidden', count: 4 },
      { ...UNREAD, kind: 'area', area: 'assignments', code: 'lms.area_hidden', count: 2 },
    ],
  })
  server.use(
    ...handlers(listed),
    http.post(`${API}/lms/sync/materials/:id`, ({ request }) => {
      const path = new URL(request.url).pathname
      removed(path)
      const left = listed.unreadable.filter((u) => !path.includes(`/${u.id}:`))
      return HttpResponse.json({ ...listed, unreadable: left })
    }),
  )
  renderWithRouter(<InPopover />, undefined, IN_PROGRAM)
  await userEvent.click(await screen.findByRole('button', { name: /^Not updated\s*6$/ }))
  expect(await screen.findByText('Announcements: 4')).toBeInTheDocument()
  expect(screen.getByText('Assignments not imported: 2')).toBeInTheDocument()
  // Under the area's row: no course again, and why in a word.
  expect(screen.getAllByText("Can't be read")).toHaveLength(3)
  expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(2)

  await userEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]!)
  const one = await screen.findByRole('alertdialog')
  await userEvent.click(within(one).getByRole('button', { name: 'Remove' }))
  await waitFor(() => expect(removed).toHaveBeenCalledWith('/lms/sync/materials/m2:remove'))
  await waitFor(() => expect(screen.queryByText('Rubric.pdf')).not.toBeInTheDocument())
  expect(screen.queryByRole('button', { name: 'Remove all' })).not.toBeInTheDocument()
})

test('every material read online is removed at once', async () => {
  const material = (id: string, title: string): SyncUnreadable => ({
    ...UNREAD,
    kind: 'material',
    id,
    area: 'files',
    title,
    code: 'lms.forbidden',
    item_id: `i-${id}`,
    removable: true,
  })
  const removed = vi.fn<(url: string) => void>()
  server.use(
    ...handlers(
      status({ unreadable: [material('m2', 'Rubric.pdf'), material('m3', 'Notes.pdf')] }),
    ),
    http.post(`${API}/programs/p1/lms/sync/materials\\:remove`, ({ request }) => {
      removed(new URL(request.url).pathname)
      return HttpResponse.json(status())
    }),
  )
  renderWithRouter(<InPopover />, undefined, IN_PROGRAM)
  await userEvent.click(await screen.findByRole('button', { name: /^Not updated\s*2$/ }))
  await userEvent.click(await screen.findByRole('button', { name: 'Remove all' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(within(dialog).getByText('Remove 2 materials?')).toBeInTheDocument()
  await userEvent.click(within(dialog).getByRole('button', { name: 'Remove all' }))
  await waitFor(() =>
    expect(removed).toHaveBeenCalledWith('/programs/p1/lms/sync/materials:remove'),
  )
})

test('a connection that stopped working says so and goes to its settings from the panel', async () => {
  server.use(
    ...handlers(
      status({
        connection_error: 'lms.invalid_credentials',
        pending: [item({ id: 'r1', title: 'A3' })],
      }),
    ),
  )
  renderWithRouter(<InPopover />, undefined, IN_PROGRAM)
  expect(await screen.findByRole('button', { name: 'Reconnect' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Sync now' })).not.toBeInTheDocument()
  // Importing needs the platform; deciding what already waits does not.
  expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Ignore' })).toBeEnabled()
})

const MOVED = {
  id: 'r1',
  course_id: 'c1',
  course: 'CSC148',
  title: 'A3',
  field: 'due_at' as const,
  mine: { date: '2026-11-04', time: '23:59:00' },
  platform: { date: '2026-11-06', time: '23:59:00' },
  target_kind: 'assessment' as const,
  external_id: 'a1',
  target_id: 'a3',
}

test('a field set apart from the platform takes its value back from the panel', async () => {
  const sent = vi.fn<(body: unknown) => void>()
  server.use(
    ...handlers(status({ different: [MOVED] })),
    http.post(`${API}/lms/sync/items/r1/fields/due_at\\:resolve`, async ({ request }) => {
      sent(await request.json())
      return HttpResponse.json(status())
    }),
  )
  renderWithRouter(<InPopover />, undefined, IN_PROGRAM)
  await userEvent.click(await screen.findByRole('button', { name: /^Different from Canvas\s*1$/ }))
  await userEvent.click(screen.getByRole('button', { name: 'Use the Canvas value' }))
  await waitFor(() => expect(sent).toHaveBeenCalledWith({ choice: 'platform' }))
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: /Different from Canvas/ })).not.toBeInTheDocument(),
  )
})

test('editing an assessment puts the platform value of a field that differs into the form', async () => {
  const saved = vi.fn<(body: unknown) => void>()
  server.use(
    ...handlers(status({ different: [MOVED] })),
    http.patch(`${API}/assessments/a3`, async ({ request }) => {
      saved(await request.json())
      return HttpResponse.json(assessment({ id: 'a3' }))
    }),
  )
  renderWithRouter(
    <AssessmentDialog
      open
      onOpenChange={() => undefined}
      courseId="c1"
      categories={[]}
      assessment={assessment({ id: 'a3', due_date: '2026-11-04', due_time: '23:59' })}
    />,
    undefined,
    IN_PROGRAM,
  )
  await userEvent.click(await screen.findByRole('button', { name: 'Use the Canvas value' }))
  expect(screen.queryByRole('button', { name: 'Use the Canvas value' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(saved).toHaveBeenCalledWith(
      expect.objectContaining({ due_date: '2026-11-06', due_time: '23:59' }),
    ),
  )
})

test('new feedback opens the assignment on its submission and feedback', async () => {
  const change = {
    id: 'ch2',
    kind: 'feedback' as const,
    course_id: 'c1',
    course: 'CSC148',
    title: 'A3',
    field: 'feedback',
    old: null,
    new: { comments: 2, rubric: false },
    at: new Date().toISOString(),
    reverted: false,
    toggleable: false,
    target_kind: 'assessment' as const,
    external_id: 'a1',
    target_id: 'as1',
  }
  server.use(...handlers(status({ recent: [change] })))
  const { router } = renderWithRouter(<InPopover />, undefined, IN_PROGRAM)
  // Nothing to put back: the row opens the feedback.
  const row = await screen.findByRole('button', { name: /^A3 feedback.*New comments/ })
  expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  await userEvent.click(row)
  // Over the page that is on screen (M09 §7.3).
  await waitFor(() =>
    expect(router.state.location.search).toEqual({ assignment: 'c1:a1', view: 'feedback' }),
  )
})

test('a sync the user asked for shows how many courses are done', async () => {
  server.use(...handlers(status({ syncing: true, round: { done: 1, total: 3 } })))
  renderWithRouter(<InPopover />, undefined, IN_PROGRAM)
  expect(await screen.findByText('Syncing · 1 of 3 courses')).toBeInTheDocument()
  expect(screen.getByRole('progressbar', { name: 'Syncing · 1 of 3 courses' })).toBeInTheDocument()
})

test('the panel says how many course calendars are not read yet', async () => {
  // One that can't be read is a row of its course (表 5c), not counted again.
  server.use(...handlers(status({ calendar_waiting: 3, calendar_unreadable: 1 })))
  renderWithRouter(<InPopover />, undefined, IN_PROGRAM)
  expect(await screen.findByText('Course calendars not yet synced: 3')).toBeInTheDocument()
  expect(screen.queryByText('Course calendars unavailable: 1')).not.toBeInTheDocument()
})

test('on a phone the courses tab shows what waits, answered in a sheet', async () => {
  const current = status({ pending: [item({ id: 'r1', title: 'A3' })] })
  const dismissed = vi.fn<(body: unknown) => void>()
  server.use(
    ...handlers(current),
    http.post(`${API}/programs/p1/lms/sync\\:dismiss`, async ({ request }) => {
      dismissed(await request.json())
      return HttpResponse.json(status({ ignored: current.pending }))
    }),
  )
  renderWithRouter(<SyncSection programId="p1" termId="t1" />, undefined, IN_PROGRAM)
  await userEvent.click(await screen.findByRole('button', { name: /Canvas.*1 to review/ }))
  const sheet = await screen.findByRole('dialog')
  expect(within(sheet).getByText('A3')).toBeInTheDocument()
  await userEvent.click(within(sheet).getByRole('button', { name: 'Ignore' }))
  await waitFor(() =>
    expect(dismissed).toHaveBeenCalledWith({ assignment_ids: ['r1'], dismissed: true }),
  )
})
