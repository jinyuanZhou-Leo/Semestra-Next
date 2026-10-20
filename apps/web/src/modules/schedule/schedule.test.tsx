import type { EventType, Meeting, OneOffEvent, Occurrence } from '@semestra/api-client'
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
import TodayCard from './cards/TodayCard'
import { EventDialog } from './components/EventDialog'
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

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
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
        inherited: {},
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
    http.patch(`${API}/events/:id`, async ({ request }) => {
      await record(request)
      return HttpResponse.json({})
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
    http.get(`${API}/plugins/catalog`, () =>
      HttpResponse.json(
        { error: { code: 'common.internal', params: {}, request_id: 'r' } },
        { status: 500 },
      ),
    ),
    http.get(`${API}/layouts/nav/:kind`, () =>
      HttpResponse.json({ scope_type: 'program', order: [], hidden: [] }),
    ),
    http.get(`${API}/layouts/boards/:kind/:id`, () =>
      HttpResponse.json({
        scope_type: 'program',
        scope_id: 'p1',
        customized: false,
        updated_at: null,
        cards: [],
      }),
    ),
    http.get(`${API}/auth/config`, () => HttpResponse.json({ google_client_id: null })),
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

test('ICS export leaves out the courses hidden in the filters', async () => {
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  URL.createObjectURL ??= () => 'blob:x'
  URL.revokeObjectURL ??= () => {}
  const urls: URL[] = []
  server.use(
    http.get(`${API}/programs/:id/calendar.ics`, ({ request }) => {
      urls.push(new URL(request.url))
      return new HttpResponse('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n', {
        headers: { 'content-type': 'text/calendar' },
      })
    }),
  )
  await openCalendar()
  await userEvent.click(screen.getByRole('checkbox', { name: 'APS105H1' }))
  await userEvent.click(screen.getByRole('button', { name: 'Export' }))
  const dialog = await screen.findByRole('dialog')
  await userEvent.click(within(dialog).getByRole('button', { name: 'ICS' }))
  await userEvent.click(within(dialog).getByRole('button', { name: 'Export' }))
  await waitFor(() => expect(urls).toHaveLength(1))
  expect(urls[0]?.searchParams.getAll('exclude_course_ids')).toEqual(['c1'])
})

test("the today card shows the now line after the day's last class", async () => {
  server.use(
    http.get(`${API}/programs/:id/today`, () =>
      HttpResponse.json({
        day: '2026-01-12',
        timezone: 'America/Toronto',
        week: null,
        items: [lecture],
        upcoming: [],
        tasks: [],
      }),
    ),
  )
  render(
    <QueryClientProvider client={newQueryClient()}>
      <TodayCard
        scope={{ kind: 'program', programId: 'p1' }}
        instanceId="c1"
        size="xl"
        settings={undefined}
      />
    </QueryClientProvider>,
  )
  const list = await screen.findByRole('list')
  expect(within(list).getAllByRole('listitem').at(-1)).toHaveAccessibleName('Now')
})

test('saving a multi-day all-day event keeps its last day', async () => {
  const studyDays: OneOffEvent = {
    id: 'e1',
    program_id: 'p1',
    term_id: null,
    course_id: null,
    type_code: null,
    title: 'Study days',
    // Oct 1–3 in Toronto: the stored end is the midnight after the last day.
    start_at: '2026-10-01T04:00:00Z',
    end_at: '2026-10-04T04:00:00Z',
    all_day: true,
    location: null,
    note: null,
    source_kind: null,
    source_ref: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
  render(
    <QueryClientProvider client={newQueryClient()}>
      <EventDialog
        programId="p1"
        timezone="America/Toronto"
        event={studyDays}
        open
        onOpenChange={() => {}}
      />
    </QueryClientProvider>,
  )
  await userEvent.click(await screen.findByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(log.requests).toContainEqual(
      expect.objectContaining({
        method: 'PATCH',
        path: '/events/e1',
        body: expect.objectContaining({
          start_at: '2026-10-01T00:00',
          end_at: '2026-10-04T00:00',
          all_day: true,
        }),
      }),
    ),
  )
})

test('the course schedule shows a full-width week of class hours and one "Add" menu', async () => {
  mount('/p/p1/c/c1/schedule')
  const week = await screen.findByRole('region', { name: 'Week' }, { timeout: 10_000 })
  // Only the hours with classes: the 10:00–11:00 lecture, titled by type and section.
  expect(within(week).getByTestId('grid-item')).toHaveTextContent('LEC0101')
  expect(within(week).queryByText('9:00 AM', { exact: false })).not.toBeInTheDocument()
  expect(within(week).queryByText('Sat')).not.toBeInTheDocument()

  expect(screen.getByText('No one-off events yet')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Add' }))
  expect(await screen.findByRole('menuitem', { name: 'Meeting' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('menuitem', { name: 'One-off event' }))
  expect(await screen.findByRole('dialog', { name: 'Add event' })).toBeInTheDocument()
})
