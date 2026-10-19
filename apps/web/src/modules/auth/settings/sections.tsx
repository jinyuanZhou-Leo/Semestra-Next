import { useState } from 'react'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { SignOutDialog } from '../components/SignOutDialog'
import { useUser } from '../useAuth'
import { ProfileSection } from './ProfileSection'
import { SessionsSection } from './SessionsSection'
import { SignInMethodsSection } from './SignInMethodsSection'
import { TokensSection } from './TokensSection'

// The account sections as settings-framework components (M11 hosts them; the title and
// description come from the manifest).

export function ProfileSettings() {
  const [signingOut, setSigningOut] = useState(false)
  return (
    <div className="space-y-3">
      <ProfileSection user={useUser()} />
      <Button variant="destructive" onClick={() => setSigningOut(true)}>
        {m.auth_account_signout()}
      </Button>
      <SignOutDialog open={signingOut} onOpenChange={setSigningOut} />
    </div>
  )
}

export function SignInMethodsSettings() {
  return <SignInMethodsSection user={useUser()} />
}

export function SessionsSettings() {
  return <SessionsSection />
}

export function TokensSettings() {
  return <TokensSection />
}
