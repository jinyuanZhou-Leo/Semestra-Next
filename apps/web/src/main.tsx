import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './app/api'
import { initSentry } from './app/sentry'
import './app/theme.css'
import { routeTree } from './routeTree.gen'

void initSentry()

const queryClient = new QueryClient({
  // Changes made elsewhere (another tab, the agent, a job) arrive over SSE and refetch what they
  // touch (app/realtime.ts), so data a page just loaded or prefetched is not fetched again on mount.
  defaultOptions: { queries: { staleTime: 30_000 } },
})
const router = createRouter({
  routeTree,
  context: { queryClient },
  // Hovering or focusing a link loads the next page's code (see `preloadPage`); the query cache
  // decides what is fresh, so the router keeps no copy of its own.
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
