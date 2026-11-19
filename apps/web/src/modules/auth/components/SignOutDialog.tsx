import { ConfirmDialog } from '@/components/ConfirmDialog'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { useAuth } from '../useAuth'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Where to go instead of the login page, e.g. back to it with a page to return to. */
  to?: string
  /** Runs first, e.g. ending this browser's earlier sign-ins along with the current one. */
  before?: () => Promise<unknown>
}

/** Asks before signing out. Every sign-out entry point (settings, sidebar, onboarding) shares this. */
export function SignOutDialog({ open, onOpenChange, to, before }: Props) {
  const { signOut } = useAuth()
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={m.auth_signout_title()}
      description={m.auth_signout_desc()}
      confirmLabel={m.auth_account_signout()}
      onConfirm={() =>
        void (before?.().catch(toastError) ?? Promise.resolve()).then(() => signOut({ to }))
      }
    />
  )
}
