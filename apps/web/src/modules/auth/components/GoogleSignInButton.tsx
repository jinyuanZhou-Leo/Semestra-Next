import { useEffect, useRef, useState } from 'react'
import { m } from '@/paraglide/messages'
import { getLocale } from '@/paraglide/runtime'

type GoogleId = {
  initialize: (config: {
    client_id: string
    callback: (response: { credential: string }) => void
    use_fedcm_for_prompt?: boolean
  }) => void
  renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } }
  }
}

const SCRIPT_SRC = 'https://accounts.google.com/gsi/client'
let scriptPromise: Promise<void> | null = null

function loadGoogleScript(): Promise<void> {
  if (window.google?.accounts) return Promise.resolve()
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SCRIPT_SRC
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => {
      scriptPromise = null
      reject(new Error('google script failed'))
    }
    document.head.append(script)
  })
  return scriptPromise
}

type Props = {
  clientId: string
  onCredential: (idToken: string) => void
  text?: 'continue_with' | 'signin_with'
}

/** Google Identity Services button; hands the ID token to `onCredential`. */
export function GoogleSignInButton({ clientId, onCredential, text = 'continue_with' }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const callback = useRef(onCredential)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    callback.current = onCredential
  })

  useEffect(() => {
    let cancelled = false
    loadGoogleScript()
      .then(() => {
        const google = window.google?.accounts.id
        if (cancelled || !google || !container.current) return
        google.initialize({
          client_id: clientId,
          callback: (response) => callback.current(response.credential),
        })
        google.renderButton(container.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          shape: 'pill',
          text,
          width: 320,
          locale: getLocale(),
        })
      })
      .catch(() => !cancelled && setFailed(true))
    return () => {
      cancelled = true
    }
  }, [clientId, text])

  if (failed) {
    return (
      <p className="text-center text-xs text-muted-foreground">{m.auth_google_unavailable()}</p>
    )
  }
  return (
    <div ref={container} className="flex min-h-10 justify-center" data-testid="google-button" />
  )
}
