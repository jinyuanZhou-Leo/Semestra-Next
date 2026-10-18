import { useQueryClient } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import { isReauthPending, settleReauth, subscribeReauth } from '@/app/session-expiry'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/ui/dialog'
import { useAuth } from '../useAuth'
import { LoginFlow } from './LoginFlow'

/**
 * Shown over the current page when a request returns 401 while we believed to be signed in.
 * The page underneath is untouched, so unsaved form input survives; failed requests are retried.
 */
export function SessionExpiredDialog() {
  const open = useSyncExternalStore(subscribeReauth, isReauthPending, () => false)
  const queryClient = useQueryClient()
  const { user, signOut } = useAuth()

  return (
    <Dialog open={open} modal>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{m.auth_session_expired_title()}</DialogTitle>
          <DialogDescription>{m.auth_session_expired_desc()}</DialogDescription>
        </DialogHeader>
        {open ? (
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
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            settleReauth(false)
            void signOut()
          }}
        >
          {m.auth_session_expired_signout()}
        </Button>
      </DialogContent>
    </Dialog>
  )
}
