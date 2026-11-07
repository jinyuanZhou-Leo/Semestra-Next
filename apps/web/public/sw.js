// Semestra's service worker (M18 §7): shows Web Push notifications and opens the page they point
// to. It handles nothing else (no fetch handler, no cache), so deploys and the app's own reload
// after a missing chunk are unaffected.

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
  if (message.hidden_only) {
    // A Semestra tab in front already shows this (status bar, banner, the Sem panel).
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    if (windows.some((client) => client.visibilityState === 'visible')) return
  }
  await self.registration.showNotification(message.title, {
    body: message.body || '',
    tag: message.tag,
    data: { url: message.url || '/' },
    icon: '/icons/icon-192.png',
  })
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
