import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { useAuth } from '../useAuth'
import { ProfileSection } from './ProfileSection'
import { SessionsSection } from './SessionsSection'
import { SignInMethodsSection } from './SignInMethodsSection'
import { TokensSection } from './TokensSection'

/** Account sections for the settings framework (M11 hosts them; this is the stand-alone page). */
export function AccountSettings() {
  const { user, signOut } = useAuth()
  if (!user) return null
  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            {m.auth_account_title()}
          </h1>
          <p className="text-sm text-muted-foreground">{m.auth_account_subtitle()}</p>
        </div>
        <Button variant="outline" onClick={() => void signOut()}>
          {m.auth_account_signout()}
        </Button>
      </header>
      <ProfileSection user={user} />
      <SignInMethodsSection user={user} />
      <SessionsSection />
      <TokensSection />
    </div>
  )
}
