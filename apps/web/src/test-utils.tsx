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
import '@/app/api'
import { QUERY_DEFAULTS } from '@/app/query-client'
import { ThemeProvider } from '@/app/theme'

export const API = 'http://localhost:8000'

export const server = setupServer()

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
export function renderWithRouter(ui: ReactElement, queryClient = newQueryClient()) {
  const root = createRootRoute({ component: Outlet })
  const index = createRoute({ getParentRoute: () => root, path: '/', component: () => ui })
  const router = createRouter({
    routeTree: root.addChildren([index]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
    // Only `/` exists here; a navigation elsewhere (sign-out to /login, say) leaves this marker,
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
