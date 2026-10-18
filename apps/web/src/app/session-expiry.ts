// When the API says our session is gone, the app shows a "session expired" dialog instead of
// navigating away. Requests that failed with 401 wait here and are retried after a new sign-in.

type Pending = { promise: Promise<boolean>; resolve: (signedIn: boolean) => void }

let pending: Pending | null = null
const listeners = new Set<() => void>()

/** Set by AuthProvider: only a user we believed was signed in can "expire". */
let signedIn = false
export function setSignedIn(value: boolean) {
  signedIn = value
}
export function isSignedIn() {
  return signedIn
}

/** Resolves true after a successful re-login, false if the user gave up. */
export function requestReauth(): Promise<boolean> {
  if (!pending) {
    let resolve!: (signedIn: boolean) => void
    const promise = new Promise<boolean>((r) => (resolve = r))
    pending = { promise, resolve }
    listeners.forEach((l) => l())
  }
  return pending.promise
}

export function settleReauth(result: boolean) {
  const current = pending
  pending = null
  current?.resolve(result)
  listeners.forEach((l) => l())
}

export function isReauthPending() {
  return pending !== null
}

export function subscribeReauth(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
