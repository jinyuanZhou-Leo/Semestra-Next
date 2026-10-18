import type { EventType, Meeting, Occurrence } from '@semestra/api-client'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { ModuleRegistry } from '@/app/registry'
import academics from '@/modules/academics/manifest'
import { type World, academicsHandlers, defaultWorld } from '@/modules/academics/test-data'
import auth from '@/modules/auth/manifest'
import settings from '@/modules/settings/manifest'
import { routeTree } from '@/routeTree.gen'
import { API, newQueryClient, server, user } from '@/test-utils'
import schedule from './manifest'

/** FullCalendar does not lay out in jsdom; a stand-in exposes its props to the tests. */
type CalendarProps = {
  events: { id: string; title: string; display?: string }[]
  eventDrop: (info: unknown) => void
  datesSet: (info: unknown) => void
}
const calendar = vi.hoisted(() => ({ props: null as CalendarProps | null }))

vi.mock('@fullcalendar/react', () => ({
  default: forwardRef<unknown, CalendarProps>(function FakeCalendar(props, ref) {
    useEffect(() => {
      calendar.props = props
    })
    useImperativeHandle(ref, () => ({
      getApi: () => ({ prev() {}, next() {}, gotoDate() {}, changeView() {} }),
    }))
    // Like FullCalendar, report the visible dates once when mounted.
    const reported = useRef(false)
    const { datesSet } = props
    useEffect(() => {
      if (reported.current) return
      reported.current = true
      datesSet({
        start: new Date(2026, 0, 11),
        end: new Date(2026, 0, 18),
        view: {
          type: 'timeGridWeek',
          title: 'Jan 11 – 17, 2026',
          calendar: { getDate: () => new Date(2026, 0, 12) },
        },
      })
    }, [datesSet])
    return (
      <ul data-testid="calendar">
        {props.events
          .filter((e) => e.display !== 'background')
          .map((e) => (
            <li key={e.id}>{e.title}</li>
          ))}
      </ul>
    )
  }),
}))

const shots = vi.hoisted(() => ({ count: 0 }))
vi.mock('modern-screenshot', () => ({
  domToPng: async () => {
    shots.count += 1
    return 'data:image/png;base64,AAAA'
  },
}))

// The first test loads the calendar page and FullCalendar's plugins lazily, which is slow in CI.
vi.setConfig({ testTimeout: 20_000 })

beforeAll(() => server.listen())
afterEach(() => {
  server.resetHandlers()
  calendar.props = null
  shots.count = 0
  vi.restoreAllMocks()
})
afterAll(() => server.close())

const types: EventType[] = ['LEC', 'PRA', 'TUT'].map((code, position) => ({
  id: `et-${code}`,
  program_id: 'p1',
  code,
  name: code,
  color: null,
  icon: null,
  builtin: true,
  position,
}))

const meeting: Meeting = {
  id: 'm1',
  course_id: 'c1',
  term_id: 't2',
  section_code: 'LEC0101',
  type_code: 'LEC',
  title: null,
  instructor: null,
  location: 'BA 1160',
  weekday: 1,
  start_time: '10:00:00',
  end_time: '11:00:00',
  recurrence: 'weekly',
  anchor_week: 1,
  start_week: 1,
  end_week: null,
  skip_breaks: true,
  enabled: true,
  source_kind: null,
  source_ref: null,
  exceptions: [],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const lecture: Occurrence = {
  id: 'schedule.meetings:m1:2026-01-12',
  source: 'schedule.meetings',
  kind: 'class',
  title: 'APS105H1',
  start_at: '2026-01-12T15:00:00Z',
  end_at: '2026-01-12T16:00:00Z',
  all_day: false,
  course_id: 'c1',
  type_code: 'LEC',
  location: 'BA 1160',
  color_ref: 'subject-1',
  status: null,
  ref: { entity: 'schedule.meeting', id: 'm1' },
  meta: { term_id: 't2', meeting_id: 'm1', original_date: '2026-01-12', week_number: 2 },
}

type Log = { requests: { method: string; path: string; body: unknown }[] }

function scheduleHandlers(log: Log) {
  const record = async (request: Request) => {
    const body: unknown = request.method === 'GET' ? null : await request.json().catch(() => null)
    log.requests.push({ method: request.method, path: new URL(request.url).pathname, body })
  }
  return [
    http.get(`${API}/programs/:id/event-types`, () => HttpResponse.json({ items: types })),
    http.get(`${API}/programs/:id/calendar`, () =>
      HttpResponse.json({
        timezone: 'America/Toronto',
        start: '2026-01-11',
        end: '2026-01-18',
        items: [lecture],
        weeks: [],
        breaks: [],
      }),
    ),
    http.get(`${API}/courses/:id/meetings`, ({ params }) =>
      HttpResponse.json({ items: params.id === 'c1' ? [meeting] : [] }),
    ),
    http.get(`${API}/terms/:id/schedule-conflicts`, () => HttpResponse.json({ items: [] })),
    http.get(`${API}/programs/:id/events`, () => HttpResponse.json({ items: [] })),
    http.get(`${API}/programs/:id/calendar-feeds`, () => HttpResponse.json({ items: [] })),
    http.get(`${API}/settings/calendar`, () =>
      HttpResponse.json({
        namespace: 'calendar',
        scope_type: 'term',
        scope_id: 't2',
        values: {},
        sources: {},
      }),
    ),
    http.get(`${API}/terms/:id/calendar-info`, ({ params }) =>
      HttpResponse.json({
        term_id: params.id,
        timezone: 'America/Toronto',
        week_start: 7,
        weeks: [
          { start_date: '2026-01-04', end_date: '2026-01-10', number: 1, break_info: null },
          { start_date: '2026-01-11', end_date: '2026-01-17', number: 2, break_info: null },
        ],
        today: '2026-01-12',
        today_week: 2,
      }),
    ),
    http.put(`${API}/meetings/:id/exceptions/:date`, async ({ request }) => {
      await record(request)
      return HttpResponse.json({ ...meeting, exceptions: [] })
    }),
    http.patch(`${API}/meetings/:id`, async ({ request }) => {
      await record(request)
      return HttpResponse.json(meeting)
    }),
    http.put(`${API}/me/ui-state/:key`, async ({ request }) => {
      await record(request)
      return HttpResponse.json({ ok: true })
    }),
  ]
}

let world: World
let log: Log
beforeEach(() => {
  world = defaultWorld()
  log = { requests: [] }
  server.use(
    http.get(`${API}/account/me`, () => HttpResponse.json(user)),
    ...scheduleHandlers(log),
    ...academicsHandlers(world),
  )
})

function mount(path: string) {
  const queryClient = newQueryClient()
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  render(
    <ModuleRegistry value={[auth, settings, academics, schedule]}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ModuleRegistry>,
  )
  return { router, queryClient }
}

async function openCalendar() {
  mount('/p/p1/t/t2/calendar')
  await screen.findByText(
    'APS105H1',
    { selector: '[data-testid=calendar] li' },
    { timeout: 10_000 },
  )
}

function dropLecture(revert = vi.fn<() => void>()) {
  act(() =>
    calendar.props?.eventDrop({
      event: {
        extendedProps: { occurrence: lecture },
        start: new Date(2026, 0, 13, 14, 0),
        end: new Date(2026, 0, 13, 15, 0),
        allDay: false,
      },
      revert,
    }),
  )
  return revert
}

test('dragging a class asks whether to move only this one, which saves an exception', async () => {
  await openCalendar()
  dropLecture()
  const dialog = await screen.findByRole('alertdialog')
  expect(within(dialog).getByRole('button', { name: 'Whole section' })).toBeInTheDocument()
  await userEvent.click(within(dialog).getByRole('button', { name: 'Only this class' }))
  await waitFor(() =>
    expect(log.requests).toContainEqual({
      method: 'PUT',
      path: '/meetings/m1/exceptions/2026-01-12',
      body: {
        kind: 'moved',
        new_date: '2026-01-13',
        new_start_time: '14:00',
        new_end_time: '15:00',
        new_location: 'BA 1160',
        note: null,
      },
    }),
  )
})

test('"whole section" moves the meeting itself; closing the question puts the class back', async () => {
  await openCalendar()
  dropLecture()
  await userEvent.click(await screen.findByRole('button', { name: 'Whole section' }))
  await waitFor(() =>
    expect(log.requests).toContainEqual({
      method: 'PATCH',
      path: '/meetings/m1',
      body: { weekday: 2, start_time: '14:00', end_time: '15:00' },
    }),
  )

  const revert = dropLecture()
  await userEvent.click(
    within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }),
  )
  expect(revert).toHaveBeenCalled()
})

test('hiding a course in the filters hides its classes and is remembered per term', async () => {
  await openCalendar()
  await userEvent.click(screen.getByRole('checkbox', { name: 'APS105H1' }))
  await waitFor(() =>
    expect(screen.queryByText('APS105H1', { selector: '[data-testid=calendar] li' })).toBeNull(),
  )
  await waitFor(
    () =>
      expect(log.requests).toContainEqual({
        method: 'PUT',
        path: '/me/ui-state/calendar.filters.t2',
        body: { value: { sources: {}, hiddenCourses: ['c1'], showCancelled: null } },
      }),
    { timeout: 2000 },
  )
})

test('exporting the week as PNG renders it and saves the file', async () => {
  const clicks: string[] = []
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicks.push(this.download)
  })
  await openCalendar()
  await userEvent.click(screen.getByRole('button', { name: 'Export' }))
  const dialog = await screen.findByRole('dialog')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Export' }))
  await waitFor(() => expect(clicks).toEqual(['semestra-schedule.png']))
  expect(shots.count).toBe(1)
})
