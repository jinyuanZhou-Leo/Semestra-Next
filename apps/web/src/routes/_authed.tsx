import { accountMeGetOptions } from '@semestra/api-client/react-query'
import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { toApiError } from '@/app/api'

/** Everything below requires a signed-in user; others are sent to /login?redirect=… */
export const Route = createFileRoute('/_authed')({
  beforeLoad: async ({ context, location }) => {
    try {
      await context.queryClient.ensureQueryData({
        ...accountMeGetOptions(),
        revalidateIfStale: false,
      })
    } catch (err) {
      if (toApiError(err).status === 401) {
        throw redirect({ to: '/login', search: { redirect: location.href } })
      }
      throw err
    }
  },
  component: Outlet,
})
