import { authPasskeyLogin, authPasskeyOptions, type AuthResult } from '@semestra/api-client'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { errorCode } from '@/lib/errors'
import {
  cancelPasskeyRequest,
  forgetUnknownPasskey,
  getPasskey,
  passkeyAutofillAvailable,
  passkeyCancelled,
} from '@/modules/auth/passkey'

// A sign-in challenge lasts 10 minutes on the server; the waiting request is renewed before.
const REFRESH_MS = 9 * 60_000

/**
 * Signing in with a passkey (M01 §7): from the button, or from the email field's autofill while
 * `autofill` is true. Only the latest request counts: the button replaces the waiting autofill
 * one, and leaving the email step cancels it. After the button's request, or a passkey picked
 * in the field that was refused, autofill asks again, so the field keeps offering passkeys; it
 * also asks afresh before the waiting request's challenge expires. (Not when the browser itself
 * ends an autofill request: some do so at once, and asking again would only loop.)
 */
export function usePasskeySignIn({
  autofill,
  onSignedIn,
}: {
  autofill: boolean
  onSignedIn: (result: AuthResult) => void
}) {
  const [error, setError] = useState<unknown>(null)
  const [pending, setPending] = useState(false)
  const latest = useRef(0)
  // Whether the email field is showing and its autofill offers passkeys.
  const autofillOn = useRef(false)

  const run = (fromAutofill: boolean) => {
    const id = ++latest.current
    const current = () => latest.current === id
    let answered = false // the browser gave a passkey's answer
    if (!fromAutofill) {
      setPending(true)
      setError(null)
    }
    const attempt = async () => {
      const { data: options } = await authPasskeyOptions({ throwOnError: true })
      if (!current()) return null
      const credential = await getPasskey(options, { autofill: fromAutofill, current })
      answered = true
      try {
        const { data } = await authPasskeyLogin({ body: { credential }, throwOnError: true })
        return data
      } catch (err) {
        const params = (err as { params?: { credential_id?: unknown } }).params
        if (
          errorCode(err) === 'auth.passkey_unknown' &&
          typeof params?.credential_id === 'string'
        ) {
          void forgetUnknownPasskey(String(options.options.rpId), params.credential_id)
        }
        throw err
      }
    }
    attempt().then(
      (data) => {
        if (data && current()) onSignedIn(data)
      },
      (err: unknown) => {
        if (!current()) return // replaced: the newer request reports for itself
        if (!fromAutofill) setPending(false)
        const quiet =
          passkeyCancelled(err) || (fromAutofill && errorCode(err) === 'auth.passkey_expired')
        if (!quiet) setError(err)
        if (autofillOn.current && (!fromAutofill || answered)) run(true)
      },
    )
  }

  const startAutofill = useEffectEvent(() => {
    autofillOn.current = true
    if (!pending) run(true) // the button's request asks again when it ends
  })
  const stopAutofill = useEffectEvent(() => {
    autofillOn.current = false
    latest.current++
    void cancelPasskeyRequest()
  })
  useEffect(() => {
    if (!autofill) return
    let left = false
    let refresh: ReturnType<typeof setInterval> | undefined
    void passkeyAutofillAvailable().then((available) => {
      if (!available || left) return
      startAutofill()
      refresh = setInterval(startAutofill, REFRESH_MS)
    })
    return () => {
      left = true
      clearInterval(refresh)
      stopAutofill()
    }
  }, [autofill])

  return { signIn: () => run(false), pending, error }
}
