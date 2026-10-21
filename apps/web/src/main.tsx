import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './app/api'
import { QUERY_DEFAULTS } from './app/query-client'
import { initSentry } from './app/sentry'
import './app/theme.css'
import { routeTree } from './routeTree.gen'

void initSentry()

const queryClient = new QueryClient({ defaultOptions: QUERY_DEFAULTS })
const router = createRouter({
  routeTree,
  context: { queryClient },
  // Hovering or focusing a link loads the next page's code (see `preloadPage`); the query cache
  // decides what is fresh, so the router keeps no copy of its own.
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
  // While the next page's code loads the current page stays on screen, with NavigationProgress
  // along the top; no pending component, so the router never swaps the page for a blank one.
  defaultPendingComponent: undefined,
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
