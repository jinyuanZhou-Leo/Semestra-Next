import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { render } from '@testing-library/react'
import { setupServer } from 'msw/node'
import type { ReactElement } from 'react'
import { afterEach } from 'vitest'
import '@/app/api'
import { QUERY_DEFAULTS } from '@/app/query-client'
import { ThemeProvider } from '@/app/theme'

export const API = 'http://localhost:8000'

export const server = setupServer()

// A request without a handler fails the test that made it, instead of only logging (the test
// then ran against a network error it didn't mean to test). Give the screen every endpoint it
// calls; `academicsHandlers` covers the signed-in shell.
const unhandled: string[] = []
server.events.on('request:unhandled', ({ request }) => {
  unhandled.push(`${request.method} ${request.url}`)
})
afterEach(() => {
  const found = unhandled.splice(0)
  if (found.length > 0) throw new Error(`Requests without a handler:\n${found.join('\n')}`)
})

export function newQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { ...QUERY_DEFAULTS.queries, retry: false },
      mutations: { retry: false },
    },
  })
}

export function renderWithQuery(ui: ReactElement, queryClient = newQueryClient()) {
  return {
    queryClient,
    ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>),
  }
}

export const user = {
  id: 'u1',
  email: 'ada@example.com',
  display_name: 'Ada',
  avatar_url: null,
  locale: 'en',
  has_password: true,
  identities: [],
  created_at: '2026-01-01T00:00:00Z',
}

export function apiError(code: string, status: number, params: Record<string, unknown> = {}) {
  return { status, body: { error: { code, params, request_id: 'r' } } }
}

/** Renders `ui` as the index route of a throwaway router (needed by <Link> and navigation). */
export function renderWithRouter(
  ui: ReactElement,
  queryClient = newQueryClient(),
  /** Render under a route with params instead of `/`, e.g. `{ path: '/p/$programId', at: '/p/p1' }`. */
  route: { path: string; at: string } = { path: '/', at: '/' },
) {
  const root = createRootRoute({ component: Outlet })
  const index = createRoute({ getParentRoute: () => root, path: route.path, component: () => ui })
  const router = createRouter({
    routeTree: root.addChildren([index]),
    history: createMemoryHistory({ initialEntries: [route.at] }),
    // Only that route exists here; a navigation elsewhere (sign-out to /login, say) leaves this marker,
    // so a test that ends up somewhere unexpected can see it.
    defaultNotFoundComponent: () => <p data-testid="not-found">Not found</p>,
  })
  return {
    queryClient,
    router,
    ...render(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <RouterProvider router={router} />
        </ThemeProvider>
      </QueryClientProvider>,
    ),
  }
}
