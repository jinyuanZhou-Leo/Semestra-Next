import { createContext, useContext } from 'react'
import type { UserOut } from '@semestra/api-client'

export type AuthState = {
  user: UserOut | undefined
  isLoading: boolean
  /**
   * Ends the session and goes to the login page. `to` goes elsewhere; `flush: false` skips
   * saving interface state, for a session the server has already ended (account deleted).
   */
  signOut: (options?: { to?: string; flush?: boolean }) => Promise<void>
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>')
  return value
}

/** For routes behind the auth guard, where the user is always known. */
export function useUser(): UserOut {
  const { user } = useAuth()
  if (!user) throw new Error('useUser called without a signed-in user')
  return user
}
