/** Optional error tracking. Without `VITE_SENTRY_DSN` the SDK is never even downloaded. */
export async function initSentry(): Promise<void> {
  const dsn = import.meta.env.VITE_SENTRY_DSN
  if (!dsn) return
  const Sentry = await import('@sentry/react')
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0,
    // Only the error and its stack leave the browser: no URLs with ids in query strings,
    // request bodies, headers, cookies, or user identity.
    beforeSend(event) {
      delete event.user
      if (event.request) {
        event.request = { url: event.request.url?.split('?')[0] }
      }
      return event
    },
  })
}
