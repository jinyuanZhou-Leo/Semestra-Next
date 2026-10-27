import { useQueryClient } from '@tanstack/react-query'
import { Suspense, useEffect, useSyncExternalStore } from 'react'
import { preload, preloadable } from '@/app/extensions'
import { isReauthPending, settleReauth, subscribeReauth } from '@/app/session-expiry'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog'
import { Spinner } from '@/ui/spinner'
import { whenSettled } from '@/lib/when-settled'
import { useAuth } from '../useAuth'
import type { LoginFlow as LoginFlowComponent } from './LoginFlow'

// The sign-in form (with its code input) is not part of the first load: it loads once the page
// has settled, or when the dialog opens before that.
const LoginFlow = preloadable<Parameters<typeof LoginFlowComponent>[0]>(() =>
  import('./LoginFlow').then((mod) => ({ default: mod.LoginFlow })),
)

/**
 * Shown over the current page when a request returns 401 while we believed to be signed in.
 * The page underneath is untouched, so unsaved form input survives; failed requests are retried.
 */
export function SessionExpiredDialog() {
  const open = useSyncExternalStore(subscribeReauth, isReauthPending, () => false)
  const queryClient = useQueryClient()
  const { user, signOut } = useAuth()
  useEffect(() => whenSettled(() => void preload(LoginFlow)), [])

  return (
    <Dialog open={open} modal>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{m.auth_session_expired_title()}</DialogTitle>
          <DialogDescription>{m.auth_session_expired_desc()}</DialogDescription>
        </DialogHeader>
        {open ? (
          <Suspense fallback={<Spinner className="mx-auto" />}>
            <LoginFlow
              compact
              initialEmail={user?.email ?? ''}
              onSignedIn={(next) => {
                if (user && next.id !== user.id) {
                  window.location.assign('/')
                  return
                }
                void queryClient.invalidateQueries()
                settleReauth(true)
              }}
            />
          </Suspense>
        ) : null}
        <DialogFooter className="sm:justify-start">
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              settleReauth(false)
              void signOut()
            }}
          >
            {m.auth_session_expired_signout()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
