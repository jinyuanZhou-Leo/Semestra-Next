import type { Task, TaskList } from '@semestra/api-client'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'vitest'
import { academicsHandlers, defaultWorld } from '@/modules/academics/test-data'
import { API, renderWithRouter, server } from '@/test-utils'
import CounterCard from './cards/CounterCard'
import TodayCard from './cards/TodayCard'
import TasksPage from './pages/TasksPage'

beforeAll(() => server.listen())
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const stamp = '2026-01-01T00:00:00Z'

function task(overrides: Partial<Task> & { id: string }): Task {
  return {
    program_id: 'p1',
    term_id: null,
    course_id: null,
    list_id: null,
    title: overrides.id,
    notes: '',
    due_date: null,
    due_time: null,
    priority: 'none',
    flagged: false,
    completed_at: null,
    position: 1,
    source_kind: null,
    source_ref: null,
    overdue: false,
    created_at: stamp,
    updated_at: stamp,
    ...overrides,
  } as Task
}

type Log = { creates: Record<string, unknown>[]; completes: { id: string; body: unknown }[] }
let log: Log
let items: Task[]
let lists: TaskList[]

beforeEach(() => {
  log = { creates: [], completes: [] }
  items = [task({ id: 't1', title: 'Read chapter 3' }), task({ id: 't2', title: 'Lab report' })]
  lists = []
  server.use(
    ...academicsHandlers(defaultWorld()),
    http.get(`${API}/settings/tasks`, () =>
      HttpResponse.json({ namespace: 'tasks', values: {}, inherited: {} }),
    ),
    http.get(`${API}/programs/p1/task-lists`, () => HttpResponse.json({ items: lists })),
    http.get(`${API}/programs/p1/task-counts`, () =>
      HttpResponse.json({
        today: 0,
        overdue: 0,
        scheduled: 0,
        all: items.length,
        inbox: items.length,
        flagged: 0,
        completed: 0,
        lists: {},
        courses: {},
      }),
    ),
    http.get(`${API}/programs/p1/tasks`, ({ request }) => {
      const params = new URL(request.url).searchParams
      const finished = params.get('view') === 'completed' || params.get('only_completed') === 'true'
      const rows = items.filter((t) => (t.completed_at !== null) === finished)
      return HttpResponse.json({ items: rows, next_cursor: null })
    }),
    http.post(`${API}/programs/p1/tasks`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>
      log.creates.push(body)
      const created = task({ id: `n${log.creates.length}`, title: String(body.title) })
      items = [...items, created]
      return HttpResponse.json(created, { status: 201 })
    }),
    http.post(`${API}/tasks/:id\\:complete`, async ({ params, request }) => {
      const body = await request.json()
      log.completes.push({ id: String(params.id), body })
      items = items.filter((t) => t.id !== params.id)
      return HttpResponse.json(task({ id: String(params.id), completed_at: stamp }))
    }),
  )
})

test('the page lists the tasks and adds one from the quick-add box', async () => {
  renderWithRouter(<TasksPage scope={{ kind: 'program', programId: 'p1' }} />)
  expect(await screen.findByText('Read chapter 3')).toBeTruthy()
  expect(screen.getByText('Lab report')).toBeTruthy()
  await userEvent.type(await screen.findByLabelText('Add a task'), 'Write essay !!{Enter}')
  await waitFor(() => expect(log.creates).toHaveLength(1))
  expect(log.creates[0]).toMatchObject({ title: 'Write essay', priority: 'high' })
  expect(await screen.findByText('Write essay')).toBeTruthy()
})

test('checking a task off completes it', async () => {
  renderWithRouter(<TasksPage scope={{ kind: 'program', programId: 'p1' }} />)
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Complete Lab report' }))
  await waitFor(() => expect(log.completes).toHaveLength(1))
  expect(log.completes[0]).toEqual({ id: 't2', body: { completed: true } })
})

test('an empty list says so', async () => {
  items = []
  renderWithRouter(<TasksPage scope={{ kind: 'program', programId: 'p1' }} />)
  expect(await screen.findByText('No tasks here')).toBeTruthy()
})

test('the Today card shows what is due and quick add defaults to today', async () => {
  items = [task({ id: 't1', title: 'Pay fees', due_date: '2026-01-12' })]
  renderWithRouter(
    <TodayCard
      scope={{ kind: 'program', programId: 'p1' }}
      instanceId="i1"
      size="l"
      settings={undefined}
    />,
  )
  expect(await screen.findByText('Pay fees')).toBeTruthy()
  await userEvent.type(screen.getByLabelText('Add a task'), 'Call home{Enter}')
  await waitFor(() => expect(log.creates).toHaveLength(1))
  expect(log.creates[0]?.due_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
})

test('the counter card shows the open count', async () => {
  renderWithRouter(
    <CounterCard
      scope={{ kind: 'term', programId: 'p1', termId: 't2' }}
      instanceId="i1"
      size="s"
      settings={undefined}
    />,
  )
  expect(await screen.findByText('2')).toBeTruthy()
})

test('the completed view has one empty state and no add box', async () => {
  renderWithRouter(<TasksPage scope={{ kind: 'program', programId: 'p1' }} />)
  await userEvent.click(await screen.findByRole('button', { name: /^Completed/ }))
  expect(await screen.findByText('Nothing completed yet')).toBeTruthy()
  expect(screen.queryByText('No tasks here')).toBeNull()
  expect(screen.queryByLabelText('Add a task')).toBeNull()
})

test('clearing completed tasks is offered only where it deletes what is listed', async () => {
  items = [
    task({ id: 't1', title: 'Open' }),
    task({ id: 't2', title: 'Done one', completed_at: stamp }),
  ]
  renderWithRouter(<TasksPage scope={{ kind: 'program', programId: 'p1' }} />)
  await screen.findByText('Open')
  await screen.findByRole('button', { name: /1 completed/ })
  expect(screen.queryByRole('button', { name: 'Clear completed' })).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: /^Completed/ }))
  expect(await screen.findByRole('button', { name: 'Clear completed' })).toBeTruthy()
})

test('selecting a task opens its details in a sheet', async () => {
  renderWithRouter(<TasksPage scope={{ kind: 'program', programId: 'p1' }} />)
  await userEvent.click(await screen.findByText('Lab report'))
  expect(await screen.findByRole('dialog', { name: 'Details' })).toBeTruthy()
})
