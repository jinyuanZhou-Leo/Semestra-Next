import type { Task, TaskList } from '@semestra/api-client'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'vitest'
import { academicsHandlers, defaultWorld } from '@/modules/academics/test-data'
import { ShellSidebarOpen } from '@/app/host/ShellToolbar'
import { API, renderWithRouter, server } from '@/test-utils'
import { SidebarMenu, SidebarMenuItem, SidebarProvider } from '@/ui/sidebar'
import CounterCard from './cards/CounterCard'
import TodayCard from './cards/TodayCard'
import { TasksSidebarNav } from './components/TasksSidebar'
import { flushCompletions } from './completion'
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
  deletes: string[]
  queries: Record<string, string>[]
}
let log: Log
let items: Task[]
let lists: TaskList[]
/** Holds task pages back, to see what the page shows while they load. */
let slow: boolean

beforeEach(() => {
  slow = false
  log = { creates: [], completes: [], updates: [], deletes: [], queries: [] }
  items = [task({ id: 't1', title: 'Read chapter 3' }), task({ id: 't2', title: 'Lab report' })]
  lists = []
  server.use(
    ...academicsHandlers(defaultWorld()),
    http.get(`${API}/me/settings/tasks`, () =>
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
    http.get(`${API}/programs/p1/tasks`, async ({ request }) => {
      if (slow) await delay(200)
      const params = new URL(request.url).searchParams
      const finished = params.get('view') === 'completed' || params.get('only_completed') === 'true'
      const rows = items.filter((t) => (t.completed_at !== null) === finished)
      const limit = Number(params.get('limit') ?? 200)
      log.queries.push(Object.fromEntries(params))
      return HttpResponse.json({
        items: rows.slice(0, limit),
        next_cursor: rows.length > limit ? String(limit) : null,
        total: rows.length,
      })
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
    http.delete(`${API}/tasks/:id`, ({ params }) => {
      log.deletes.push(String(params.id))
      items = items.filter((t) => t.id !== params.id)
      return new HttpResponse(null, { status: 204 })
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

test('a checked-off task waits in place, can be unchecked, and is then completed', async () => {
  renderWithRouter(<TasksPage scope={{ kind: 'program', programId: 'p1' }} />)
  const check = await screen.findByRole('checkbox', { name: 'Complete Lab report' })
  await userEvent.click(check)
  expect(check).toBeChecked()
  // Unchecked while it waits: nothing is saved.
  await userEvent.click(check)
  expect(check).not.toBeChecked()
  act(() => flushCompletions())
  expect(log.completes).toHaveLength(0)
  await userEvent.click(check)
  act(() => flushCompletions())
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

test('folded completed tasks are only counted, and long lists load more on demand', async () => {
  items = [
    ...Array.from({ length: 3 }, (_, n) => task({ id: `o${n}`, title: `Open ${n}` })),
    ...Array.from({ length: 4 }, (_, n) =>
      task({ id: `d${n}`, title: `Done ${n}`, completed_at: stamp }),
    ),
  ]
  renderWithRouter(<TasksPage scope={{ kind: 'program', programId: 'p1' }} />)
  // The total comes from the server, not from the rows loaded: one row is fetched for it.
  const folded = await screen.findByRole('button', { name: /4 completed/ })
  slow = true
  await userEvent.click(folded)
  // While the rows load the section stays where it is.
  expect(screen.getByRole('button', { name: /4 completed/ })).toBeTruthy()
  expect(log.queries.some((q) => q.only_completed === 'true' && q.limit === '1')).toBe(true)
  expect(await screen.findByText('Done 3')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull()
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

test('an open row shows notes and chips; opening another row saves it first', async () => {
  renderWithRouter(<TasksPage scope={{ kind: 'program', programId: 'p1' }} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Edit title: Read chapter 3' }))
  const notes = screen.getByRole('textbox', { name: 'Notes' })
  expect(screen.getByRole('button', { name: 'Date' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Priority' })).toBeTruthy()
  await userEvent.type(notes, 'Sections 3.1 to 3.4')
  // Only one row is open: opening the next one closes and saves this one.
  await userEvent.click(screen.getByRole('button', { name: 'Edit title: Lab report' }))
  await waitFor(() => expect(log.updates).toHaveLength(1))
  expect(log.updates[0]).toEqual({ id: 't1', body: { notes: 'Sections 3.1 to 3.4' } })
  expect(screen.getAllByRole('textbox', { name: 'Title' })).toHaveLength(1)
  expect((screen.getByRole('textbox', { name: 'Title' }) as HTMLInputElement).value).toBe(
    'Lab report',
  )
})

test('Esc throws away the edit, and a chip saves right away', async () => {
  renderWithRouter(<TasksPage scope={{ kind: 'program', programId: 'p1' }} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Edit title: Lab report' }))
  const input = screen.getByRole('textbox', { name: 'Title' })
  await userEvent.type(input, ' draft')
  const row = input.closest('li')!
  await userEvent.click(within(row).getByRole('button', { name: 'Flag', pressed: false }))
  await waitFor(() => expect(log.updates).toHaveLength(1))
  expect(log.updates[0]).toEqual({ id: 't2', body: { flagged: true } })
  await userEvent.type(screen.getByRole('textbox', { name: 'Title' }), '{Escape}')
  expect(screen.queryByRole('textbox', { name: 'Title' })).toBeNull()
  expect(log.updates).toHaveLength(1)
})

test('clicking outside saves; a title left empty deletes the task without asking', async () => {
  renderWithRouter(<TasksPage scope={{ kind: 'program', programId: 'p1' }} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Edit title: Lab report' }))
  await userEvent.clear(screen.getByRole('textbox', { name: 'Title' }))
  await userEvent.click(document.body)
  await waitFor(() => expect(log.deletes).toEqual(['t2']))
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect(log.updates).toHaveLength(0)
})

test('checking off a row being edited keeps what was typed', async () => {
  renderWithRouter(<TasksPage scope={{ kind: 'program', programId: 'p1' }} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Edit title: Lab report' }))
  await userEvent.type(screen.getByRole('textbox', { name: 'Title' }), ' v2')
  await userEvent.click(screen.getByRole('checkbox', { name: 'Complete Lab report' }))
  await waitFor(() => expect(log.updates).toEqual([{ id: 't2', body: { title: 'Lab report v2' } }]))
  act(() => flushCompletions())
  await waitFor(() => expect(log.completes).toHaveLength(1))
})

test('Esc on a chip closes the row, and focus goes back to its title', async () => {
  renderWithRouter(<TasksPage scope={{ kind: 'program', programId: 'p1' }} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Edit title: Lab report' }))
  screen.getByRole('button', { name: 'Date' }).focus()
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('textbox', { name: 'Title' })).toBeNull()
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'Edit title: Lab report' }),
  )
  // Enter on the title opens it again; Enter in the field saves and gives focus back.
  await userEvent.keyboard('{Enter}')
  await userEvent.keyboard('{End} v2{Enter}')
  await waitFor(() => expect(log.updates).toEqual([{ id: 't2', body: { title: 'Lab report v2' } }]))
  expect(document.activeElement?.getAttribute('aria-label')).toMatch(/^Edit title: Lab report/)
})

test('the empty row at the end adds tasks one after another', async () => {
  renderWithRouter(<TasksPage scope={{ kind: 'program', programId: 'p1' }} />)
  await userEvent.click(await screen.findByRole('button', { name: 'New task' }))
  const input = screen.getByRole('textbox', { name: 'New task' })
  await userEvent.type(input, 'Problem set 4{Enter}')
  await waitFor(() => expect(log.creates).toHaveLength(1))
  expect(log.creates[0]).toMatchObject({ title: 'Problem set 4' })
  // The field stays open for the next one; Esc drops what was typed.
  await userEvent.type(screen.getByRole('textbox', { name: 'New task' }), 'Never mind{Escape}')
  expect(screen.queryByRole('textbox', { name: 'New task' })).toBeNull()
  expect(log.creates).toHaveLength(1)
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

test("an assessment's task keeps its title, date and course, and links to the gradebook", async () => {
  items = [
    task({
      id: 't3',
      title: 'APS105H1 · Midterm',
      course_id: 'c1',
      due_date: '2026-03-02',
      source_kind: 'assessment',
      source_ref: 'a1',
    }),
  ]
  renderWithRouter(<TasksPage scope={{ kind: 'program', programId: 'p1' }} />)
  await userEvent.click(
    await screen.findByRole('button', { name: 'Edit title: APS105H1 · Midterm' }),
  )
  const title = screen.getByRole('textbox', { name: 'Title' }) as HTMLInputElement
  expect(title.readOnly).toBe(true)
  const row = title.closest('li')!
  expect(within(row).getByRole('button', { name: /Mar/ })).toHaveProperty('disabled', true)
  expect(within(row).getByRole('button', { name: 'APS105H1' })).toHaveProperty('disabled', true)
  // The rest still saves.
  await userEvent.click(within(row).getByRole('button', { name: 'Flag', pressed: false }))
  await waitFor(() => expect(log.updates).toEqual([{ id: 't3', body: { flagged: true } }]))
  await userEvent.type(title, '{Escape}')

  await userEvent.click(screen.getByRole('button', { name: 'More actions for APS105H1 · Midterm' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit details' }))
  const sheet = await screen.findByRole('dialog', { name: 'Details' })
  expect((within(sheet).getByRole('textbox', { name: 'Title' }) as HTMLInputElement).readOnly).toBe(
    true,
  )
  expect(within(sheet).getByRole('combobox', { name: 'Course' })).toHaveProperty('disabled', true)
  expect(within(sheet).getByRole('link', { name: 'Open the gradebook' }).getAttribute('href')).toBe(
    '/p/p1/c/c1/grades',
  )
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

const many = () =>
  Array.from({ length: 300 }, (_, i) =>
    task({ id: `m${i}`, title: `Task ${String(i + 1).padStart(3, '0')}`, position: i + 1 }),
  )

test('a long list renders only the rows near the screen, and says how long it is', async () => {
  items = many()
  renderWithRouter(<TasksPage scope={{ kind: 'program', programId: 'p1' }} />)
  const first = (await screen.findByText('Task 001')).closest('li')!
  expect(first.getAttribute('aria-posinset')).toBe('1')
  expect(first.getAttribute('aria-setsize')).toBe('300')
  const rendered = document.querySelectorAll('li[data-task-id]').length
  expect(rendered).toBeGreaterThan(0)
  expect(rendered).toBeLessThan(100)
  expect(screen.queryByText('Task 300')).toBeNull()
})

test('the row being edited stays rendered when the list scrolls away from it', async () => {
  items = many()
  renderWithRouter(<TasksPage scope={{ kind: 'program', programId: 'p1' }} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Edit title: Task 001' }))
  expect(screen.getByRole('textbox', { name: 'Title' })).toBeTruthy()

  // jsdom has no layout: scroll the page by hand, the list moving up with it.
  const scroller = document.scrollingElement ?? document.documentElement
  const list = screen.getByText('Task 002').closest('ul')!
  const offset = 199 * 44
  Object.defineProperty(scroller, 'scrollTop', { configurable: true, get: () => offset })
  list.getBoundingClientRect = () => ({ top: -offset }) as DOMRect
  act(() => scroller.dispatchEvent(new Event('scroll')))
  expect(await screen.findByText('Task 200')).toBeTruthy()
  expect(screen.getByRole('textbox', { name: 'Title' })).toBeTruthy()
  // The rows in between are not rendered for it.
  expect(screen.queryByText('Task 080')).toBeNull()
})
