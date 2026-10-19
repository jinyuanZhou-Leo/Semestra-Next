import { createFileRoute, Link } from '@tanstack/react-router'
import { AuthLayout } from '@/modules/auth/components/AuthLayout'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'

/** Shown right after account deletion (M13 §5): the session is gone, the data is being deleted. */
export const Route = createFileRoute('/account-deleted')({
  component: AccountDeletedPage,
})

function AccountDeletedPage() {
  return (
    <AuthLayout>
      <div className="mb-6 space-y-1.5">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          {m.portability_deleted_title()}
        </h1>
        <p className="text-sm text-muted-foreground">{m.portability_deleted_desc()}</p>
      </div>
      <Button variant="outline" nativeButton={false} render={<Link to="/login" />}>
        {m.portability_deleted_back()}
      </Button>
    </AuthLayout>
  )
}
