import { useRouter } from '@tanstack/react-router'
import { useEffect } from 'react'
import { isSupported, syncDevice } from './push'

/**
 * Runs once in the signed-in app (M18 §7): keeps this device's subscription current and opens
 * the page a clicked notification points to, without reloading the app.
 */
export function NotificationsSync() {
  const router = useRouter()
  useEffect(() => {
    void syncDevice()
    if (!isSupported()) return
    const onMessage = (event: MessageEvent<{ type?: string; url?: string }>) => {
      if (event.data?.type !== 'semestra:navigate' || !event.data.url) return
      const url = new URL(event.data.url, window.location.origin)
      if (url.origin !== window.location.origin) return
      void router.navigate({ href: url.pathname + url.search + url.hash })
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [router])
  return null
}
