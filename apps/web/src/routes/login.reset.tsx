import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { z } from 'zod'
import { AuthLayout } from '@/modules/auth/components/AuthLayout'
import { ResetPasswordFlow } from '@/modules/auth/components/ResetPasswordFlow'

export const Route = createFileRoute('/login/reset')({
  validateSearch: z.object({ email: z.string().optional() }),
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
