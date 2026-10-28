import { accountProfileGetOptions } from '@semestra/api-client/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { redirect } from '@tanstack/react-router'
import { toApiError } from '@/app/api'

/** Only follow same-origin paths after login; anything else falls back to the home page. */
export function safeRedirect(target: string | undefined | null): string {
  if (!target || !target.startsWith('/') || target.startsWith('//') || target.startsWith('/\\')) {
    return '/'
  }
  return target
}

/**
 * Waits until the user is known to be signed in; otherwise sends them to /login?redirect=…
 * The signed-in routes check in `/_authed`'s loader; a route below whose `beforeLoad` reads
 * data calls it first, as that runs before the loader.
 */
export async function requireSignIn(queryClient: QueryClient, href: string): Promise<void> {
  try {
    await queryClient.ensureQueryData({ ...accountProfileGetOptions(), revalidateIfStale: false })
  } catch (err) {
    if (toApiError(err).status === 401) throw redirect({ to: '/login', search: { redirect: href } })
    throw err
  }
}
