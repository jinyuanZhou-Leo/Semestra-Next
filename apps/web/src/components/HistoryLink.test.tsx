import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { HistoryLink } from './HistoryLink'

function mount() {
  const loader = vi.fn<() => void>()
  const root = createRootRoute({ component: Outlet })
  const home = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <HistoryLink href="/next?tab=a">Next</HistoryLink>,
  })
  const next = createRoute({
    getParentRoute: () => root,
    path: '/next',
    loader,
    component: () => <p>Next page</p>,
  })
  const router = createRouter({
    routeTree: root.addChildren([home, next]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
  })
  render(<RouterProvider router={router} />)
  return { loader, router }
}

test("hovering a link runs the target route's loader before the click", async () => {
  const { loader, router } = mount()
  await userEvent.hover(await screen.findByRole('link', { name: 'Next' }))
  await waitFor(() => expect(loader).toHaveBeenCalledTimes(1))
  expect(router.state.location.pathname).toBe('/')

  await userEvent.click(screen.getByRole('link', { name: 'Next' }))
  expect(await screen.findByText('Next page')).toBeInTheDocument()
  expect(router.state.location.searchStr).toBe('?tab=a')
})

test('moving away before the delay preloads nothing', async () => {
  const { loader } = mount()
  const link = await screen.findByRole('link', { name: 'Next' })
  fireEvent.mouseEnter(link)
  fireEvent.mouseLeave(link)
  await new Promise((done) => setTimeout(done, 100))
  expect(loader).not.toHaveBeenCalled()
})
