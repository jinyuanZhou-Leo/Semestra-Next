// Semestra's service worker (M18 §7): shows Web Push notifications, opens the page they point to
// and hands a replaced subscription to the API. It handles nothing else (no fetch handler, no
// cache), so deploys and the app's own reload after a missing chunk are unaffected.

// Where the API is (the page registers the worker with `?api=`; empty when it is this origin).
const API = new URL(self.location.href).searchParams.get('api') ?? ''

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let message
  try {
    message = event.data ? event.data.json() : null
  } catch {
    message = null
  }
  if (!message || !message.title) return
  event.waitUntil(show(message))
})

async function show(message) {
  // Every push must show a notification: the subscription promises it (`userVisibleOnly`),
  // Safari revokes subscriptions that receive silent pushes and Chrome shows its own "updated in
  // the background" notice instead. So one that a Semestra tab in front already shows (status
  // bar, banner, the Sem panel) is shown silently and closed straight away.
  const seen = Boolean(message.hidden_only) && (await inFront())
  await self.registration.showNotification(message.title, {
    body: message.body || '',
    tag: message.tag,
    data: { url: message.url || '/' },
    icon: '/icons/icon-192.png',
    silent: seen,
  })
  if (seen) {
    const shown = await self.registration.getNotifications({ tag: message.tag })
    for (const notification of shown) notification.close()
  }
}

async function inFront() {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  return windows.some((client) => client.visibilityState === 'visible')
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href
  event.waitUntil(open(url))
})

async function open(url) {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const tab = windows.find((client) => new URL(client.url).origin === self.location.origin)
  if (tab) {
    // The open app routes there itself, without reloading (`NotificationsSync`).
    tab.postMessage({ type: 'semestra:navigate', url })
    await tab.focus()
    return
  }
  await self.clients.openWindow(url)
}

// A push service may replace the subscription at any time, while no tab is open: without this
// the device would stop getting notifications until the app is opened again. The old
// subscription's endpoint and secret stand for the device (the worker has no CSRF token).
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(renew(event.oldSubscription, event.newSubscription))
})

async function renew(old, current) {
  if (!old) return // the next start of the app sends the subscription again
  const sub =
    current ??
    (await self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: old.options.applicationServerKey,
    }))
  const keys = sub.toJSON().keys ?? {}
  await fetch(`${API}/notifications/devices/renew`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      old_endpoint: old.endpoint,
      old_auth: base64url(old.getKey('auth')),
      endpoint: sub.endpoint,
      p256dh: keys.p256dh ?? '',
      auth: keys.auth ?? '',
    }),
  })
}

function base64url(buffer) {
  const bytes = new Uint8Array(buffer ?? new ArrayBuffer(0))
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}
