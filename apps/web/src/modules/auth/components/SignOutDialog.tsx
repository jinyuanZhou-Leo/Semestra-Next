import { ConfirmDialog } from '@/components/ConfirmDialog'
import { m } from '@/paraglide/messages'
import { useAuth } from '../useAuth'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Asks before signing out. Every sign-out entry point (settings, sidebar, onboarding) shares this. */
export function SignOutDialog({ open, onOpenChange }: Props) {
  const { signOut } = useAuth()
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={m.auth_signout_title()}
      description={m.auth_signout_desc()}
      confirmLabel={m.auth_account_signout()}
      onConfirm={() => void signOut()}
    />
  )
}
