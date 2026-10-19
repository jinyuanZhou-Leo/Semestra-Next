import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { FileText, NotebookPen } from 'lucide-react'
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { defineModule } from '@/app/extensions'
import { ModuleRegistry } from '@/app/registry'
import auth from '@/modules/auth/manifest'
import settings from '@/modules/settings/manifest'
import { routeTree } from '@/routeTree.gen'
import { API, newQueryClient, server, user } from '@/test-utils'
import academics from './manifest'
import { type World, academicsHandlers, defaultWorld } from './test-data'

beforeAll(() => server.listen())
afterEach(() => {
  server.resetHandlers()
  sessionStorage.clear()
  vi.unstubAllGlobals()
})
afterAll(() => server.close())

/** A course page for the hotkey test; not available on c2, so switching there opens the overview. */
const notes = defineModule({
  id: 'notes',
  kind: 'plugin',
  name: () => 'Notes',
  description: () => 'Notes',
  icon: NotebookPen,
  pages: [
    {
      id: 'notes',
      scopes: ['course'],
      title: () => 'Notes',
      icon: FileText,
      component: () => <p>Notes page</p>,
      order: 50,
      isAvailable: (scope) => scope.kind !== 'course' || scope.courseId !== 'c2',
    },
  ],
})

let world: World
beforeEach(() => {
  world = defaultWorld()
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
  const view = render(
    <ModuleRegistry value={[auth, settings, academics, notes]}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ModuleRegistry>,
  )
  return { router, ...view }
}

test('/ opens the remembered Program, else the first one', async () => {
  world.programs.push({ ...world.programs[0]!, id: 'p2', name: 'Minor in Music' })
  world.activeProgramId = 'p2'
  const { router } = mount('/')
  await waitFor(() => expect(router.state.location.pathname).toBe('/p/p2'))
})

test('/ without any Program starts onboarding', async () => {
  world.programs = []
  const { router } = mount('/')
  await waitFor(() => expect(router.state.location.pathname).toBe('/onboarding'))
  expect(await screen.findByRole('heading', { name: 'Welcome to Semestra' })).toBeInTheDocument()
})

test('the sidebar shows the current term with its courses and leaves other terms out', async () => {
  mount('/p/p1')
  const nav = await screen.findByRole('navigation', { name: 'Main navigation' })
  expect(await within(nav).findByRole('link', { name: /APS105H1/ })).toHaveAttribute(
    'href',
    '/p/p1/c/c1?fromTerm=t2',
  )
  expect(within(nav).getByText('Current term')).toBeInTheDocument()
  expect(within(nav).getByRole('link', { name: 'Winter 2026' })).toBeInTheDocument()
  expect(within(nav).queryByRole('link', { name: 'Fall 2025' })).not.toBeInTheDocument()
  expect(within(nav).getAllByRole('link', { name: /ESC180Y1/ })).toHaveLength(1)
  expect(within(nav).queryByText('Pinned')).not.toBeInTheDocument()
})

test('a term the user chose as current replaces the one of today in the sidebar', async () => {
  world.uiState['academics.current_term.p1'] = 't1'
  mount('/p/p1')
  const nav = await screen.findByRole('navigation', { name: 'Main navigation' })
  expect(await within(nav).findByRole('link', { name: 'Fall 2025' })).toBeInTheDocument()
  expect(await within(nav).findByRole('link', { name: /ESC180Y1/ })).toHaveAttribute(
    'href',
    '/p/p1/c/c3?fromTerm=t1',
  )
  expect(within(nav).queryByRole('link', { name: 'Winter 2026' })).not.toBeInTheDocument()
})

test('a chosen current term that no longer exists falls back to the term of today', async () => {
  world.uiState['academics.current_term.p1'] = 'deleted'
  mount('/p/p1')
  const nav = await screen.findByRole('navigation', { name: 'Main navigation' })
  expect(await within(nav).findByRole('link', { name: 'Winter 2026' })).toBeInTheDocument()
})

test('the Program pages are in the sidebar and have no tab bar', async () => {
  mount('/p/p1')
  const nav = await screen.findByRole('navigation', { name: 'Main navigation' })
  expect(await within(nav).findByRole('link', { name: 'Overview' })).toHaveAttribute(
    'aria-current',
    'page',
  )
  expect(within(nav).getByRole('link', { name: 'Terms & courses' })).toBeInTheDocument()
  await screen.findByRole('heading', { level: 1, name: 'Overview' })
  expect(document.querySelector('[data-tour="page-tabs"]')).toBeNull()
})

test('a term page keeps its tab bar and pins to the sidebar', async () => {
  mount('/p/p1/t/t1')
  await screen.findByRole('heading', { level: 1, name: 'Fall 2025' })
  expect(document.querySelector('[data-tour="page-tabs"]')).not.toBeNull()
  expect(await screen.findByRole('button', { name: 'Pin to sidebar' })).toBeInTheDocument()
})

test('the sidebar offers each entry once', async () => {
  mount('/p/p1')
  const nav = await screen.findByRole('navigation', { name: 'Main navigation' })
  await within(nav).findByRole('link', { name: /APS105H1/ })
  // Settings, pin and the page tabs live on the page; the current term's menu keeps only delete.
  await userEvent.click(within(nav).getByRole('button', { name: 'More for Winter 2026' }))
  expect(await screen.findByRole('menuitem', { name: 'Delete term' })).toBeInTheDocument()
  expect(screen.queryByRole('menuitem', { name: /settings|pin|move/i })).not.toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  // New terms are made on the Terms & courses page, not from the sidebar.
  expect(within(nav).queryByRole('link', { name: 'New term' })).not.toBeInTheDocument()
})

test('"+" adds another term to the sidebar, where it unfolds to its courses and can be unpinned', async () => {
  mount('/p/p1')
  const nav = await screen.findByRole('navigation', { name: 'Main navigation' })
  await userEvent.click(
    await within(nav).findByRole('button', { name: 'Add a term to the sidebar' }),
  )
  // The current term is already there, so only the other one is offered.
  expect(screen.queryByRole('option', { name: /Winter 2026/ })).not.toBeInTheDocument()
  await userEvent.click(await screen.findByRole('option', { name: /Fall 2025/ }))
  expect(await within(nav).findByText('Pinned')).toBeInTheDocument()
  expect(within(nav).getByRole('link', { name: 'Fall 2025' })).toHaveAttribute('href', '/p/p1/t/t1')
  expect(within(nav).getAllByRole('link', { name: /ESC180Y1/ })).toHaveLength(1)
  await userEvent.click(within(nav).getByRole('button', { name: 'Show courses' }))
  await waitFor(() =>
    expect(within(nav).getAllByRole('link', { name: /ESC180Y1/ })).toHaveLength(2),
  )
  await userEvent.click(within(nav).getByRole('button', { name: 'More for Fall 2025' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Unpin' }))
  await waitFor(() => expect(within(nav).queryByText('Pinned')).not.toBeInTheDocument())
})

test('pinned terms and courses keep their order and move with the menu', async () => {
  world.uiState['academics.pinned.p1'] = [
    { kind: 'course', id: 'c2' },
    { kind: 'term', id: 't1' },
    // A pin of the current term waits until it stops being current; a deleted course is skipped.
    { kind: 'term', id: 't2' },
    { kind: 'course', id: 'gone' },
  ]
  mount('/p/p1')
  const nav = await screen.findByRole('navigation', { name: 'Main navigation' })
  const pinned = (await within(nav).findByText('Pinned')).closest('[data-slot="sidebar-group"]')
  const rows = () =>
    within(pinned as HTMLElement)
      .getAllByRole('link')
      .map((link) => link.textContent)
  await waitFor(() => expect(rows()).toEqual(['MAT188H1', 'Fall 2025']))
  await userEvent.click(within(nav).getByRole('button', { name: 'More for MAT188H1' }))
  expect(await screen.findByRole('menuitem', { name: 'Move up' })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
  await userEvent.click(screen.getByRole('menuitem', { name: 'Move down' }))
  await waitFor(() => expect(rows()).toEqual(['Fall 2025', 'MAT188H1']))
})

test('with a single Program the Program menu still offers a new one', async () => {
  mount('/p/p1')
  await userEvent.click(await screen.findByRole('button', { name: 'Switch program' }))
  expect(await screen.findByRole('menuitem', { name: 'New program' })).toBeInTheDocument()
  expect(screen.getByRole('menuitem', { name: /Computer Engineering/ })).toHaveAttribute(
    'href',
    '/p/p1',
  )
})

test('a Program without terms says so once in the sidebar, with a single way to add one', async () => {
  world.terms = []
  world.courses = []
  mount('/p/p1')
  const nav = await screen.findByRole('navigation', { name: 'Main navigation' })
  expect(await within(nav).findByText('No terms yet')).toBeInTheDocument()
  expect(within(nav).getAllByRole('link', { name: 'New term' })).toHaveLength(1)
})

test('signing out from the account menu asks first', async () => {
  mount('/p/p1')
  await userEvent.click(await screen.findByRole('button', { name: 'Account menu' }))
  const signOut = await screen.findByRole('menuitem', { name: 'Sign out' })
  // Settings sits in the sidebar and New program in the Program switcher; the menu repeats neither.
  expect(screen.queryByRole('menuitem', { name: /settings|new program/i })).not.toBeInTheDocument()
  await userEvent.click(signOut)
  const dialog = await screen.findByRole('alertdialog')
  expect(within(dialog).getByRole('heading', { name: 'Sign out?' })).toBeInTheDocument()
  await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
})

test('Cmd/Ctrl+↓ opens the next course of the term and keeps the page', async () => {
  const { router } = mount('/p/p1/c/c3/notes?fromTerm=t2')
  expect(await screen.findByText('Notes page')).toBeInTheDocument()
  // The term's courses have loaded (the sidebar shares the query).
  await screen.findByRole('link', { name: /MAT188H1/ })
  // The term's order is c1, c2, c3: ↑ from c3 goes to c2, which has no notes page.
  fireEvent.keyDown(window, { key: 'ArrowUp', ctrlKey: true })
  await waitFor(() => expect(router.state.location.pathname).toBe('/p/p1/c/c2'))
  expect(router.state.location.search).toEqual({ fromTerm: 't2' })
  expect(
    await screen.findAllByRole('link', { name: 'MAT188H1', current: 'page' }),
  ).not.toHaveLength(0)
  // ↑ again reaches c1, which has notes; a held key inside 150 ms is ignored.
  await new Promise((resolve) => setTimeout(resolve, 160))
  fireEvent.keyDown(window, { key: 'ArrowUp', ctrlKey: true })
  fireEvent.keyDown(window, { key: 'ArrowUp', ctrlKey: true })
  await waitFor(() => expect(router.state.location.pathname).toBe('/p/p1/c/c1'))
  await new Promise((resolve) => setTimeout(resolve, 160))
  fireEvent.keyDown(window, { key: 'ArrowDown', metaKey: true })
  await waitFor(() => expect(router.state.location.pathname).toBe('/p/p1/c/c2'))
})

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

function dayButtonName(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number) as [number, number, number]
  const date = new Date(year, month - 1, day)
  const mod100 = day % 100
  const suffix =
    mod100 >= 11 && mod100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[day % 10] ?? 'th')
  const weekday = date.toLocaleDateString('en-US', { weekday: 'long' })
  return `${weekday}, ${MONTHS[month - 1]} ${day}${suffix}, ${year}`
}

/** Opens the date picker labeled `name` and chooses `iso` (`yyyy-MM-dd`). */
async function pickDate(name: string, iso: string) {
  await userEvent.click(screen.getByRole('button', { name }))
  const [year, month] = iso.split('-').map(Number) as [number, number]
  const target = year * 12 + (month - 1)
  for (let i = 0; i < 36; i++) {
    const day = screen.queryByRole('button', { name: dayButtonName(iso) })
    if (day) {
      await userEvent.click(day)
      return
    }
    const caption = screen.getByText(new RegExp(`^(${MONTHS.join('|')}) \\d{4}$`))
    const [monthName, yearText] = caption.textContent!.split(' ')
    const shown = Number(yearText) * 12 + MONTHS.indexOf(monthName!)
    await userEvent.click(
      screen.getByRole('button', {
        name: shown < target ? 'Go to the Next Month' : 'Go to the Previous Month',
      }),
    )
  }
  throw new Error(`could not find ${iso} in the date picker`)
}

test('the term wizard survives a reload and creates the term in one request', async () => {
  const first = mount('/p/p1/terms/new')
  await screen.findByRole('button', { name: 'First day' })
  await pickDate('First day', '2026-09-08')
  await pickDate('Last day', '2026-12-20')
  expect(screen.getByLabelText('Name')).toHaveValue('Fall 2026')
  await userEvent.click(screen.getByRole('button', { name: 'Next' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Add course' }))
  await userEvent.type(screen.getByLabelText('Title, row 1'), 'Signals')
  first.unmount()

  // A reload: the same tab, a new app.
  const { router } = mount('/p/p1/terms/new')
  expect(await screen.findByLabelText('Title, row 1')).toHaveValue('Signals')
  await userEvent.click(screen.getByRole('button', { name: 'Next' }))
  expect(await screen.findByText('New courses: 1')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Create term' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/p/p1/t/t3'))
  expect(world.termCreates).toEqual([
    expect.objectContaining({
      name: 'Fall 2026',
      start_date: '2026-09-08',
      end_date: '2026-12-20',
      courses: [expect.objectContaining({ title: 'Signals', planned_terms: 1 })],
      // ESC180Y1 already has both its terms, so nothing waits to be continued.
      continue_course_ids: [],
    }),
  ])
  expect(sessionStorage.getItem('semestra.termWizard.p1')).toBeNull()
})

test('on a phone the sidebar is a drawer and other pages ask for a desktop', async () => {
  vi.stubGlobal('innerWidth', 500)
  mount('/p/p1')
  expect(await screen.findByText('Open this on a computer')).toBeInTheDocument()
  expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
  const drawer = await screen.findByRole('dialog')
  expect(await within(drawer).findByRole('link', { name: /APS105H1/ })).toBeInTheDocument()
  // Only Today and the terms and courses: no overview or terms & courses links.
  expect(within(drawer).queryByRole('link', { name: 'Terms & courses' })).not.toBeInTheDocument()
  await act(async () => {
    await userEvent.click(within(drawer).getByRole('link', { name: /APS105H1/ }))
  })
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

/** The "Settings" buttons on screen: the sidebar entry and the gear of the page header. */
async function settingsButtons() {
  const inSidebar = (button: HTMLElement) => button.closest('[data-slot="sidebar"]') !== null
  // The page header loads after the sidebar.
  const buttons = await waitFor(() => {
    const found = screen.getAllByRole('button', { name: 'Settings' })
    expect(found.some((b) => !inSidebar(b))).toBe(true)
    return found
  })
  return { sidebar: buttons.find(inSidebar)!, gear: buttons.find((b) => !inSidebar(b))! }
}

test("the gear of a page header opens that scope's settings as a dialog, and Back closes it", async () => {
  const { router } = mount('/p/p1/t/t2')
  await userEvent.click((await settingsButtons()).gear)
  const dialog = await screen.findByRole('dialog', { name: 'Winter 2026' })
  expect(router.state.location.pathname).toBe('/p/p1/t/t2')
  expect(router.state.location.search).toEqual({ settings: 'term' })
  expect(await within(dialog).findByRole('heading', { name: 'Basics' })).toBeInTheDocument()

  // Back goes to the page without the dialog.
  act(() => router.history.back())
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(router.state.location.search).toEqual({})
})

test('the sidebar Settings entry opens the account settings and closing leaves the page', async () => {
  const { router } = mount('/p/p1')
  await userEvent.click((await settingsButtons()).sidebar)
  const dialog = await screen.findByRole('dialog', { name: 'Settings' })
  expect(router.state.location.search).toEqual({ settings: 'account' })

  // Switching groups replaces the entry instead of stacking history.
  await userEvent.click(within(dialog).getByRole('button', { name: 'About' }))
  expect(router.state.location.search).toEqual({ settings: 'account/about' })
  await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(router.state.location.pathname).toBe('/p/p1')
  expect(router.state.location.search).toEqual({})
})

test('old settings links open the dialog over the scope page', async () => {
  const { router } = mount('/p/p1/c/c1/settings/general')
  expect(await screen.findByRole('dialog', { name: /APS105H1/ })).toBeInTheDocument()
  expect(router.state.location.pathname).toBe('/p/p1/c/c1')
  expect(router.state.location.search).toEqual({ settings: 'course/general' })
})

test('a level the page does not have opens on the current term, with the course still to pick', async () => {
  mount('/p/p1?settings=term/general')
  const dialog = await screen.findByRole('dialog', { name: 'Winter 2026' })
  const path = within(dialog).getByRole('list', { name: 'Settings level' })
  expect(within(path).getByRole('button', { name: /Term\s*Winter 2026/ })).toHaveAttribute(
    'aria-current',
    'true',
  )
  expect(within(path).getByRole('button', { name: /Course\s*Choose a course/ })).toBeInTheDocument()
})

test('the level path switches levels and courses in the same dialog, with the scope in the URL', async () => {
  const { router } = mount('/p/p1/c/c1?settings=course/general')
  const dialog = await screen.findByRole('dialog', { name: /APS105H1/ })
  const path = within(dialog).getByRole('list', { name: 'Settings level' })

  await userEvent.click(within(path).getByRole('button', { name: /Program/ }))
  await waitFor(() =>
    expect(router.state.location.search).toEqual({ settings: 'program/general', scope: 'p1' }),
  )
  expect(router.state.location.pathname).toBe('/p/p1/c/c1')

  await userEvent.click(within(path).getByLabelText('Switch course'))
  await userEvent.click(await screen.findByRole('option', { name: /MAT188H1/ }))
  await waitFor(() =>
    expect(router.state.location.search).toEqual({ settings: 'course/general', scope: 'c2' }),
  )
  expect(await screen.findByRole('dialog', { name: /MAT188H1/ })).toBeInTheDocument()
})

test('a link with a scope opens that course from any page', async () => {
  mount('/p/p1?settings=course/general&scope=c3')
  expect(await screen.findByRole('dialog', { name: /ESC180Y1/ })).toBeInTheDocument()
})
