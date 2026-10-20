import { accountProfileGetOptions, authLogoutMutation } from '@semestra/api-client/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, type ReactNode } from 'react'
import { toApiError } from '@/app/api'
import { setSignedIn } from '@/app/session-expiry'
import { flushUiPrefs } from '@/app/ui-pref'
import { toastError } from '@/lib/errors'
import { SessionExpiredDialog } from './components/SessionExpiredDialog'
import { AuthContext, type AuthState } from './useAuth'

/** Loads the current user once at startup and hosts the "session expired" dialog. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const me = useQuery({ ...accountProfileGetOptions(), retry: false, staleTime: 60_000 })
  const { mutateAsync: logOut } = useMutation(authLogoutMutation())

  const user = me.data
  useEffect(() => {
    setSignedIn(user !== undefined)
  }, [user])

  // The React Compiler memoizes this; no manual useMemo.
  const value: AuthState = {
    user,
    isLoading: me.isPending,
    signOut: async ({ to = '/login', flush = true } = {}) => {
      // Interface state changed in the last moments belongs to this session: save it first.
      if (flush) await flushUiPrefs(queryClient)
      else setSignedIn(false) // the session is already gone; a 401 now is not "expired"
      try {
        await logOut({})
      } catch (err) {
        // The HttpOnly cookie can only be cleared by the server. A 401 means the session is
        // already gone; anything else (network, 5xx) leaves it usable, so stay put and say so.
        if (toApiError(err).status !== 401) {
          toastError(err)
          return
        }
      }
      setSignedIn(false)
      queryClient.clear()
      await navigate({ to })
    },
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
      <SessionExpiredDialog />
    </AuthContext.Provider>
  )
}
