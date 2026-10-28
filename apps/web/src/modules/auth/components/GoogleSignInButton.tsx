import { useEffect, useRef, useState } from 'react'
import { useTheme } from '@/app/theme'
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

// Google renders the button at a fixed pixel width between these bounds.
const MIN_WIDTH = 200
const MAX_WIDTH = 400
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
  /** `inline` renders the compact pill used on the right of a settings row. */
  variant?: 'block' | 'inline'
}

/** Google Identity Services button; hands the ID token to `onCredential`. */
export function GoogleSignInButton({
  clientId,
  onCredential,
  text = 'continue_with',
  variant = 'block',
}: Props) {
  const container = useRef<HTMLDivElement>(null)
  const callback = useRef(onCredential)
  const [failed, setFailed] = useState(false)
  const theme = useTheme().resolved

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
        // Full width in the sign-in form, so it lines up with the inputs and buttons above it.
        const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, container.current.clientWidth))
        container.current.replaceChildren()
        google.renderButton(container.current, {
          type: 'standard',
          theme: theme === 'dark' ? 'filled_black' : 'outline',
          shape: 'pill',
          text,
          locale: getLocale(),
          ...(variant === 'inline' ? { size: 'medium' } : { size: 'large', width }),
        })
      })
      .catch(() => !cancelled && setFailed(true))
    return () => {
      cancelled = true
    }
  }, [clientId, text, variant, theme])

  const inline = variant === 'inline'
  if (failed) {
    return (
      <p
        className={
          inline ? 'text-xs text-muted-foreground' : 'text-center text-xs text-muted-foreground'
        }
      >
        {m.auth_google_unavailable()}
      </p>
    )
  }
  return (
    <div
      ref={container}
      // Google's iframe is a light page: under the app's dark `color-scheme` the browser would
      // paint an opaque white box behind the rounded button.
      className={
        inline
          ? 'flex min-h-8 items-center [color-scheme:light]'
          : 'flex min-h-10 justify-center [color-scheme:light]'
      }
      data-testid="google-button"
    />
  )
}
