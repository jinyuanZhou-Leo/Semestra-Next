import type { Course } from '@semestra/api-client'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Percent } from 'lucide-react'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'vitest'
import { defineModule } from '@/app/extensions'
import { ModuleRegistry } from '@/app/registry'
import auth from '@/modules/auth/manifest'
import settings from '@/modules/settings/manifest'
import { routeTree } from '@/routeTree.gen'
import { API, newQueryClient, server, user } from '@/test-utils'
import academics from './manifest'
import { type World, academicsHandlers, defaultWorld } from './test-data'
import { COURSE_COLUMNS, type CourseColumn } from './types'

beforeAll(() => server.listen())
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

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

function mount(path: string, extra: ReturnType<typeof defineModule>[] = []) {
  const queryClient = newQueryClient()
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  render(
    <ModuleRegistry value={[auth, settings, academics, ...extra]}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ModuleRegistry>,
  )
  return router
}

/** The app subtree remounts once when the saved language arrives; wait it out before clicking. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 150)))

const search = (router: ReturnType<typeof mount>) =>
  router.state.location.search as Record<string, string>

test('the old All courses address opens the courses tab', async () => {
  const router = mount('/p/p1/courses')
  await waitFor(() => expect(router.state.location.pathname).toBe('/p/p1/academics'))
  expect(search(router)).toEqual({ tab: 'courses' })
  expect(await screen.findByRole('link', { name: 'Computer Fundamentals' })).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: 'Courses', selected: true })).toBeInTheDocument()
})

test('the terms tab selects the current term and shows its courses', async () => {
  mount('/p/p1/academics')
  const list = await screen.findByRole('list', { name: 'Terms' })
  const items = within(list).getAllByRole('listitem')
  // Newest first, the current one marked and selected.
  expect(
    items.map((li) => within(li).getAllByText(/Fall 2025|Winter 2026/)[0]?.textContent),
  ).toEqual(['Winter 2026', 'Fall 2025'])
  expect(within(items[0]!).getByRole('button', { current: true })).toBeInTheDocument()
  await settle()
  expect(await screen.findByRole('link', { name: 'Linear Algebra' })).toBeInTheDocument()
  // The term column is gone: this view is about one term.
  expect(screen.queryByRole('columnheader', { name: 'Terms' })).not.toBeInTheDocument()
})

test('picking a term selects it and carries over to the courses tab as its filter', async () => {
  const router = mount('/p/p1/academics')
  const list = await screen.findByRole('list', { name: 'Terms' })
  await userEvent.click(within(list).getByRole('button', { name: /Fall 2025/ }))
  await waitFor(() => expect(search(router).term).toBe('t1'))
  // Only the year-long course runs in Fall 2025.
  expect(await screen.findByRole('link', { name: 'Year-long design' })).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Linear Algebra' })).not.toBeInTheDocument()

  await userEvent.click(screen.getByRole('tab', { name: 'Courses' }))
  await waitFor(() => expect(search(router).tab).toBe('courses'))
  expect(search(router).term).toBe('t1')
  expect(await screen.findByRole('combobox', { name: 'Term' })).toHaveTextContent('Fall 2025')
  expect(screen.queryByRole('link', { name: 'Linear Algebra' })).not.toBeInTheDocument()
})

test('a term can be made the current one, and follows the calendar again', async () => {
  mount('/p/p1/academics?term=t1')
  expect(await screen.findByRole('heading', { name: 'Fall 2025' })).toBeInTheDocument()
  const pane = screen.getByRole('region', { name: 'Fall 2025' })
  await userEvent.click(within(pane).getByRole('button', { name: 'Set as current term' }))
  expect(await within(pane).findByText('Now')).toBeInTheDocument()
  await userEvent.click(within(pane).getByRole('button', { name: 'Follow the calendar' }))
  await waitFor(() =>
    expect(within(pane).queryByRole('button', { name: 'Follow the calendar' })).toBeNull(),
  )
  expect(within(pane).queryByText('Now')).not.toBeInTheDocument()
})

test('selecting rows puts the batch actions in place of the filters, keeping the search box', async () => {
  mount('/p/p1/academics?tab=courses')
  await screen.findByRole('searchbox', { name: 'Search courses' })
  await settle()
  const searchBox = screen.getByRole('searchbox', { name: 'Search courses' })
  const filters = screen.getByRole('combobox', { name: 'Subject' }).parentElement!
  const toolbar = screen.getByRole('toolbar', { hidden: true })
  // Both live in one grid cell, so the row keeps its height and the table never moves.
  expect(filters.parentElement).toBe(toolbar.parentElement)
  expect(within(filters).getByRole('combobox', { name: 'Term' })).toBeInTheDocument()
  expect(toolbar).toHaveAttribute('inert')

  await userEvent.click(screen.getByRole('checkbox', { name: 'Select APS105H1' }))
  await waitFor(() => expect(toolbar).not.toHaveAttribute('inert'))
  expect(filters).toHaveAttribute('inert')
  expect(within(toolbar).getByText('1 selected')).toBeInTheDocument()
  expect(within(toolbar).getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  // The search box is not part of the swap.
  expect(searchBox.closest('[inert]')).toBeNull()

  await userEvent.click(within(toolbar).getByRole('button', { name: 'Clear selection' }))
  await waitFor(() => expect(toolbar).toHaveAttribute('inert'))
  expect(filters).not.toHaveAttribute('inert')

  await userEvent.click(screen.getByRole('checkbox', { name: 'Select MAT188H1' }))
  await waitFor(() => expect(toolbar).not.toHaveAttribute('inert'))
  await userEvent.keyboard('{Escape}')
  await waitFor(() => expect(toolbar).toHaveAttribute('inert'))
  expect(screen.getByRole('checkbox', { name: 'Select MAT188H1' })).not.toBeChecked()
})

test('batch delete asks first, then deletes the selected courses', async () => {
  const deleted: string[] = []
  server.use(
    http.delete(`${API}/courses/:id`, ({ params }) => {
      deleted.push(String(params.id))
      return new HttpResponse(null, { status: 204 })
    }),
  )
  mount('/p/p1/academics?tab=courses')
  await screen.findByRole('searchbox', { name: 'Search courses' })
  await settle()
  await userEvent.click(screen.getByRole('checkbox', { name: 'Select APS105H1' }))
  await userEvent.click(screen.getByRole('checkbox', { name: 'Select MAT188H1' }))
  const toolbar = screen.getByRole('toolbar')
  await userEvent.click(within(toolbar).getByRole('button', { name: 'Delete' }))
  const dialog = await screen.findByRole('alertdialog', { name: 'Delete 2 courses?' })
  expect(deleted).toEqual([])
  await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
  await waitFor(() => expect(deleted.toSorted()).toEqual(['c1', 'c2']))
})

test('each column that contributes filters gets its own dropdown', async () => {
  const gpa = defineModule({
    id: 'fake-gpa',
    kind: 'core',
    name: () => 'Fake GPA',
    description: () => '',
    icon: Percent,
    extensions: {
      [COURSE_COLUMNS]: [
        {
          id: 'fake.gpa',
          header: () => 'GPA',
          cell: () => null,
          filter: [
            { id: 'fake.high', label: () => 'GPA ≥ 3.5', test: (c: Course) => c.id === 'c1' },
            { id: 'fake.hidden', label: () => 'Hidden', test: () => true, available: () => false },
          ],
        },
      ] satisfies CourseColumn[],
    },
  })
  mount('/p/p1/academics?tab=courses', [gpa])
  await screen.findByRole('link', { name: 'Linear Algebra' })
  await settle()
  const dropdown = screen.getByRole('combobox', { name: 'GPA' })
  expect(dropdown).toHaveTextContent('Any GPA')
  await userEvent.click(dropdown)
  expect(screen.queryByRole('option', { name: 'Hidden' })).not.toBeInTheDocument()
  await userEvent.click(await screen.findByRole('option', { name: 'GPA ≥ 3.5' }))
  await waitFor(() =>
    expect(screen.queryByRole('link', { name: 'Linear Algebra' })).not.toBeInTheDocument(),
  )
  expect(screen.getByRole('link', { name: 'Computer Fundamentals' })).toBeInTheDocument()
})

test('a course can be pinned from the table', async () => {
  mount('/p/p1/academics?tab=courses')
  await screen.findAllByRole('button', { name: 'Pin to sidebar' })
  await settle()
  await userEvent.click(screen.getAllByRole('button', { name: 'Pin to sidebar' })[0]!)
  expect((await screen.findAllByRole('button', { name: 'Unpin' })).length).toBe(1)
})

test('pinning or selecting a row keeps the button, so keyboard focus stays on it', async () => {
  mount('/p/p1/academics?tab=courses')
  await screen.findAllByRole('button', { name: 'Pin to sidebar' })
  await settle()
  const pin = screen.getAllByRole('button', { name: 'Pin to sidebar' })[0]!
  await userEvent.click(pin)
  await screen.findByRole('button', { name: 'Unpin' })
  expect(pin.isConnected).toBe(true)

  const checkbox = screen.getByRole('checkbox', { name: 'Select MAT188H1' })
  await userEvent.click(checkbox)
  await waitFor(() => expect(checkbox).toBeChecked())
  expect(checkbox.isConnected).toBe(true)
})
