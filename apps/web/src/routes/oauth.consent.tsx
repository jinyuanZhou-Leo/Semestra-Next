import { accountAuthorizationGetOptions } from '@semestra/api-client/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { ConsentPage } from '@/modules/assistant/oauth/ConsentPage'
import { requireSignIn } from '@/modules/auth/redirect'

/**
 * Where an app such as ChatGPT or Claude sends the browser to ask for access (M12 §5.3). Signed
 * out, it goes through the login page and comes back.
 */
export const Route = createFileRoute('/oauth/consent')({
  validateSearch: (search: Record<string, unknown>): { request: string } => ({
    request: typeof search.request === 'string' ? search.request : '',
  }),
  beforeLoad: ({ context, location }) => requireSignIn(context.queryClient, location.href),
  loaderDeps: ({ search }) => ({ request: search.request }),
  loader: ({ context, deps }) =>
    deps.request
      ? context.queryClient.prefetchQuery(
          accountAuthorizationGetOptions({ query: { request: deps.request } }),
        )
      : undefined,
  component: function OAuthConsent() {
    const { request } = Route.useSearch()
    return <ConsentPage request={request} />
  },
})
