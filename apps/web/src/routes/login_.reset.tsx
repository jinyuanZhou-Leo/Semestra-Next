import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { AuthLayout } from '@/modules/auth/components/AuthLayout'
import { ResetPasswordFlow } from '@/modules/auth/components/ResetPasswordFlow'

export const Route = createFileRoute('/login_/reset')({
  validateSearch: (search: Record<string, unknown>): { email?: string } => ({
    email: typeof search.email === 'string' ? search.email : undefined,
  }),
  component: ResetPage,
})

function ResetPage() {
  const { email } = Route.useSearch()
  const navigate = useNavigate()
  return (
    <AuthLayout>
      <ResetPasswordFlow initialEmail={email} onSignedIn={() => void navigate({ to: '/' })} />
    </AuthLayout>
  )
}
