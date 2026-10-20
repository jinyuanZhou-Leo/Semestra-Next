import type { Task, TaskList } from '@semestra/api-client'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'vitest'
import { academicsHandlers, defaultWorld } from '@/modules/academics/test-data'
import { ShellSidebarOpen } from '@/app/host/ShellToolbar'
import { API, renderWithRouter, server } from '@/test-utils'
import { SidebarMenu, SidebarMenuItem, SidebarProvider } from '@/ui/sidebar'
import CounterCard from './cards/CounterCard'
import TodayCard from './cards/TodayCard'
import { TasksSidebarNav } from './components/TasksSidebar'
import TasksPage from './pages/TasksPage'

/** Without the app sidebar the page title is the menu of lists. */
async function pickList(current: string, name: RegExp) {
  await userEvent.click(await screen.findByRole('button', { name: current }))
  await userEvent.click(await screen.findByRole('menuitemradio', { name }))
}

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
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

type Log = {
  creates: Record<string, unknown>[]
  completes: { id: string; body: unknown }[]
  updates: { id: string; body: Record<string, unknown> }[]
}
let log: Log
let items: Task[]
let lists: TaskList[]

beforeEach(() => {
  log = { creates: [], completes: [], updates: [] }
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
    http.patch(`${API}/tasks/:id`, async ({ params, request }) => {
      const body = (await request.json()) as Record<string, unknown>
      log.updates.push({ id: String(params.id), body })
      const current = items.find((t) => t.id === params.id)!
      const next = { ...current, ...body } as Task
      items = items.map((t) => (t.id === next.id ? next : t))
      return HttpResponse.json(next)
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
  expect(log.creates[0]).toMatchObject({ title: 'Write essay', priority: 'medium' })
  expect(await screen.findByText('Write essay')).toBeTruthy()
})

test('checking a task off completes it', async () => {
  renderWithRouter(<TasksPage scope={{ kind: 'program', programId: 'p1' }} />)
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Complete Lab report' }))
  await waitFor(() => expect(log.completes).toHaveLength(1))
  expect(log.completes[0]).toEqual({ id: 't2', body: { completed: true } })
})

test('an empty list says so, with the add box above the empty state', async () => {
  items = []
  renderWithRouter(<TasksPage scope={{ kind: 'program', programId: 'p1' }} />)
  const empty = await screen.findByText('No tasks here')
  const input = screen.getByLabelText('Add a task')
  expect(input.compareDocumentPosition(empty) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
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
  await pickList('All', /^Completed/)
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
  await pickList('All', /^Completed/)
  expect(await screen.findByRole('button', { name: 'Clear completed' })).toBeTruthy()
})

test('clicking a title edits it in place without opening the side panel', async () => {
  renderWithRouter(<TasksPage scope={{ kind: 'program', programId: 'p1' }} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Edit title: Lab report' }))
  const input = screen.getByRole('textbox', { name: 'Title' })
  await userEvent.clear(input)
  await userEvent.type(input, 'Lab report v2{Enter}')
  await waitFor(() => expect(log.updates).toHaveLength(1))
  expect(log.updates[0]).toEqual({ id: 't2', body: { title: 'Lab report v2' } })
  expect(screen.queryByRole('dialog', { name: 'Details' })).toBeNull()
})

test('"Edit details" opens the side panel, and saving closes it', async () => {
  renderWithRouter(<TasksPage scope={{ kind: 'program', programId: 'p1' }} />)
  await userEvent.click(await screen.findByRole('button', { name: 'More actions for Lab report' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit details' }))
  const sheet = await screen.findByRole('dialog', { name: 'Details' })
  await userEvent.click(within(sheet).getByRole('button', { name: 'High' }))
  await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(log.updates).toHaveLength(1))
  expect(log.updates[0]).toEqual({ id: 't2', body: { priority: 'high' } })
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Details' })).toBeNull())
})

test('Enter opens the selected task, but a focused button keeps Enter for itself', async () => {
  renderWithRouter(<TasksPage scope={{ kind: 'program', programId: 'p1' }} />)
  const row = (await screen.findByText('Lab report')).closest('li')!
  await userEvent.click(row)
  expect(row.hasAttribute('data-selected')).toBe(true)
  // Focus on a button: Enter presses the button (opens its menu), not the details panel.
  screen.getByRole('button', { name: 'More actions for Read chapter 3' }).focus()
  await userEvent.keyboard('{Enter}')
  expect(await screen.findByRole('menuitem', { name: 'Edit details' })).toBeTruthy()
  expect(screen.queryByRole('dialog', { name: 'Details' })).toBeNull()
  await userEvent.keyboard('{Escape}')
  // Nothing focused: Enter opens the selected task.
  ;(document.activeElement as HTMLElement | null)?.blur()
  await userEvent.keyboard('{Enter}')
  expect(await screen.findByRole('dialog', { name: 'Details' })).toBeTruthy()
})

test('an urgent task shows as high and stays urgent unless changed', async () => {
  items = [task({ id: 't1', title: 'Exam prep', priority: 'urgent' })]
  renderWithRouter(<TasksPage scope={{ kind: 'program', programId: 'p1' }} />)
  expect(await screen.findByLabelText('Priority: High')).toBeTruthy()
})

test('tasks in no list are called Unsorted', async () => {
  renderWithRouter(<TasksPage scope={{ kind: 'program', programId: 'p1' }} />)
  await userEvent.click(await screen.findByRole('button', { name: 'All' }))
  expect(await screen.findByRole('menuitemradio', { name: /^Unsorted/ })).toBeTruthy()
  expect(screen.queryByText('Inbox')).toBeNull()
})

test('in the app sidebar the lists sit under Tasks, and the page drops its own switcher', async () => {
  lists = [
    {
      id: 'l1',
      program_id: 'p1',
      term_id: null,
      name: 'Personal',
      color: null,
      icon: null,
      position: 1,
      created_at: stamp,
      updated_at: stamp,
    } as TaskList,
  ]
  renderWithRouter(
    <SidebarProvider>
      <SidebarMenu>
        <SidebarMenuItem>
          <TasksSidebarNav scope={{ kind: 'program', programId: 'p1' }} onNavigate={() => {}} />
        </SidebarMenuItem>
      </SidebarMenu>
      <ShellSidebarOpen value>
        <TasksPage scope={{ kind: 'program', programId: 'p1' }} />
      </ShellSidebarOpen>
    </SidebarProvider>,
  )
  const nav = await screen.findByRole('list', { name: 'Tasks' })
  await userEvent.click(await within(nav).findByRole('button', { name: 'Personal' }))
  expect(await screen.findByRole('heading', { level: 2, name: 'Personal' })).toBeTruthy()
  expect(within(nav).getByRole('button', { name: 'Personal' })).toHaveAttribute(
    'aria-current',
    'true',
  )
  // No menu of lists on the page while the sidebar shows them.
  expect(screen.getAllByRole('button', { name: 'Personal' })).toHaveLength(1)
})
