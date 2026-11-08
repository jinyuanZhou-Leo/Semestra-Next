import {
  notificationsConfigGet,
  notificationsDeviceRegister,
  notificationsDeviceUnregister,
} from '@semestra/api-client'
import { useSyncExternalStore } from 'react'

/**
 * Notifications on this device (M18 §7): the browser's permission, the service worker and the
 * push subscription that the server sends to. One state for the whole app, so the settings row,
 * the onboarding step and the pomodoro card agree.
 *
 * - `unsupported`: no Web Push here (an old browser, a private window in some).
 * - `install`: iPhone and iPad only get Web Push from an app added to the home screen.
 * - `off`: allowed or not asked yet, but this device is not subscribed.
 * - `blocked`: the user said no; only the browser's site settings can change it.
 */
export type DeviceState = 'checking' | 'unsupported' | 'install' | 'off' | 'blocked' | 'on'

let state: DeviceState = 'checking'
const listeners = new Set<() => void>()

function set(next: DeviceState) {
  if (next === state) return
  state = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useDeviceState(): DeviceState {
  return useSyncExternalStore(subscribe, () => state)
}

export function deviceState(): DeviceState {
  return state
}

export function isSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

function isAppleMobile(): boolean {
  return (
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    // iPadOS reports itself as a Mac.
    (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1)
  )
}

/** Whether notifications can be turned on here at all (or after adding to the home screen). */
export function canOffer(): boolean {
  return isSupported() || isAppleMobile()
}

let registration: Promise<ServiceWorkerRegistration> | undefined

function worker(): Promise<ServiceWorkerRegistration> {
  registration ??= navigator.serviceWorker
    .register('/sw.js')
    .then(() => navigator.serviceWorker.ready)
  return registration
}

function decodeKey(value: string): Uint8Array<ArrayBuffer> {
  const base64 = (value + '='.repeat((4 - (value.length % 4)) % 4))
    .replaceAll('-', '+')
    .replaceAll('_', '/')
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
}

function sameKey(subscription: PushSubscription, key: Uint8Array): boolean {
  const own = subscription.options.applicationServerKey
  if (!own) return false
  const bytes = new Uint8Array(own)
  return bytes.length === key.length && bytes.every((byte, i) => byte === key[i])
}

async function publicKey(): Promise<Uint8Array<ArrayBuffer>> {
  const { data } = await notificationsConfigGet({ throwOnError: true })
  return decodeKey(data.public_key)
}

/** The subscription for the server's current key, made if needed, and saved on the server. */
async function subscribeAndSave(): Promise<void> {
  const reg = await worker()
  const key = await publicKey()
  let sub = await reg.pushManager.getSubscription()
  // The server's key changed (a new secret key): the old subscription no longer works.
  if (sub && !sameKey(sub, key)) {
    await sub.unsubscribe()
    sub = null
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
  const json = sub.toJSON()
  await notificationsDeviceRegister({
    body: { endpoint: sub.endpoint, p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
    throwOnError: true,
  })
}

function fromPermission(): DeviceState {
  if (!isSupported()) return isAppleMobile() ? 'install' : 'unsupported'
  if (Notification.permission === 'denied') return 'blocked'
  return 'off'
}

/**
 * On every start of the signed-in app: registers the worker and, when this device is on, sends
 * the subscription again (it moves to the current sign-in session and stays current).
 */
export async function syncDevice(): Promise<void> {
  const initial = fromPermission()
  if (initial !== 'off' || Notification.permission !== 'granted') {
    set(initial)
    if (initial === 'off') void worker()
    return
  }
  try {
    const sub = await (await worker()).pushManager.getSubscription()
    if (!sub) return set('off')
    await subscribeAndSave()
    set('on')
  } catch {
    set('off')
  }
}

/** Asks for permission (from a click) and subscribes. Resolves to the new state. */
export async function enableDevice(): Promise<DeviceState> {
  if (!isSupported()) {
    set(fromPermission())
    return state
  }
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    set(permission === 'denied' ? 'blocked' : 'off')
    return state
  }
  await subscribeAndSave()
  set('on')
  return state
}

export async function disableDevice(): Promise<void> {
  const sub = isSupported() ? await (await worker()).pushManager.getSubscription() : null
  if (sub) {
    await notificationsDeviceUnregister({ body: { endpoint: sub.endpoint }, throwOnError: true })
    await sub.unsubscribe()
  }
  set(fromPermission())
}

/** A notification from the page itself (the pomodoro timer), only while this device is on. */
export async function showLocal(title: string, body: string, tag?: string): Promise<void> {
  if (state !== 'on') return
  try {
    await (await worker()).showNotification(title, { body, tag, icon: '/icons/icon-192.png' })
  } catch {
    // Not allowed here after all: stay silent.
  }
}

/**
 * After signing out: the server already stopped sending (the device belonged to the session);
 * dropping the subscription keeps the next person who signs in here from inheriting it.
 */
export async function forgetDevice(): Promise<void> {
  if (!isSupported()) return
  try {
    const sub = await (await worker()).pushManager.getSubscription()
    await sub?.unsubscribe()
  } catch {
    // Nothing to forget.
  }
  set(fromPermission())
}
