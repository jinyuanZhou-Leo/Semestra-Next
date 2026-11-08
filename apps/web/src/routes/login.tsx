import { accountProfileGetOptions } from '@semestra/api-client/react-query'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { AuthLayout } from '@/modules/auth/components/AuthLayout'
import { LoginFlow } from '@/modules/auth/components/LoginFlow'
import { safeRedirect } from '@/modules/auth/redirect'

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
  }),
  beforeLoad: async ({ context, search }) => {
    // Already signed in: skip the form.
    const me = await context.queryClient
      .fetchQuery({ ...accountProfileGetOptions(), staleTime: 60_000 })
      .catch(() => null)
    if (me) throw redirect({ href: safeRedirect(search.redirect) })
  },
  component: LoginPage,
})

function LoginPage() {
  const { redirect: target } = Route.useSearch()
  const navigate = useNavigate()
  return (
    <AuthLayout>
      <LoginFlow onSignedIn={() => void navigate({ href: safeRedirect(target) })} />
    </AuthLayout>
  )
}
