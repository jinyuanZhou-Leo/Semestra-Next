// Properties Bombadil checks in every state it reaches while it clicks, types, scrolls and goes
// back through the app (run.mjs starts it signed in). Every extractor must return a value for any
// page, including the login page and a half-rendered one: an extractor that throws ends the run
// with exit code 1 instead of reporting a violation.
import { always, eventually } from '@antithesishq/bombadil'
import { actions, extract, registerCustomAction, weighted } from '@antithesishq/bombadil/browser'
import {
  back,
  clicks,
  forward,
  inputs,
  reload,
  scroll,
} from '@antithesishq/bombadil/browser/defaults/actions'
import account from './account.json'

// Uncaught exceptions, unhandled rejections, console errors (React logs every error a boundary
// catches, so a crashed page, card or settings section ends up here) and the page's own status.
export {
  noConsoleErrors,
  noHttpErrorCodes,
  noUncaughtExceptions,
  noUnhandledPromiseRejections,
} from '@antithesishq/bombadil/browser/defaults/properties'

declare global {
  interface Window {
    bombadilFailedRequests?: string[]
  }
}

/**
 * Requests the server answered with 5xx, and with 401/403 while the browser held a session (the
 * CSRF cookie is readable and is cleared on sign-out). Bombadil's `noHttpErrorCodes` only sees the
 * document's own status; the app talks to the API with fetch, so this watches resource timings.
 */
const failedRequests = extract((state) => {
  const win = state.window
  if (!win.bombadilFailedRequests) {
    const failed: string[] = []
    win.bombadilFailedRequests = failed
    // Extractors run in the page, so this is its own PerformanceObserver.
    new PerformanceObserver((list) => {
      const signedIn = win.document.cookie.includes('semestra_csrf=')
      for (const entry of list.getEntries() as PerformanceResourceTiming[]) {
        const status = entry.responseStatus
        if (status >= 500 || (signedIn && (status === 401 || status === 403))) {
          failed.push(`${status} ${entry.name}`)
        }
      }
    }).observe({ type: 'resource', buffered: true })
  }
  return [...win.bombadilFailedRequests]
})

export const noFailedRequests = always(() => failedRequests.current.length === 0)

// Loading indicators: the boot screen, skeletons, spinners and the navigation bar.
const LOADERS = '#boot, [data-slot="skeleton"], [data-slot="spinner"], .animate-navigation-progress'

const loaders = extract(
  (state) =>
    [...state.document.querySelectorAll(LOADERS)].filter((element) => element.checkVisibility())
      .length,
)

/**
 * Waits up to 10 s for the loading indicators to go. Bombadil acts again as soon as the page is
 * quiet, and leaving a page cancels its requests, so without this a page that never finishes
 * loading would never be looked at long enough to notice.
 */
const settle = registerCustomAction('settle', async (document, window) => {
  const until = window.performance.now() + 10_000
  const loading = () =>
    [...document.querySelectorAll(LOADERS)].some((element) => element.checkVisibility())
  while (loading() && window.performance.now() < until) {
    await new Promise((resolve) => window.setTimeout(resolve, 50))
  }
})

const settled = extract((state) => {
  const action = state.lastAction
  return typeof action === 'object' && action !== null && 'Custom' in action
    ? action.Custom.name === 'settle'
    : false
})

export const loadingFinishes = always(() => !settled.current || loaders.current === 0)

/**
 * Visible buttons and links that a screen reader can name: text, `aria-label`, `aria-labelledby`
 * or `title`, or an image with alt text inside. An icon button without one reads as "button".
 * The arrow of shadcn's combobox is left out: it has no name in the generated `src/ui/combobox`,
 * and the input next to it, which opens the same list, does.
 */
const unnamedControls = extract((state) => {
  const unnamed: string[] = []
  for (const element of state.document.querySelectorAll('button, a[href], [role="button"]')) {
    if (!element.checkVisibility() || element.closest('[aria-hidden="true"]')) continue
    if (element.matches('[data-slot="input-group"] [aria-haspopup="listbox"]')) continue
    const named =
      element.textContent?.trim() ||
      element.getAttribute('aria-label')?.trim() ||
      element.getAttribute('aria-labelledby') ||
      element.getAttribute('title')?.trim() ||
      element.querySelector('img[alt]:not([alt=""]), svg[aria-label], [role="img"][aria-label]')
    if (!named) unnamed.push(element.outerHTML.slice(0, 200))
  }
  return unnamed
})

export const controlsHaveNames = always(() => unnamedControls.current.length === 0)

/**
 * How far the page, or an area made to scroll only up and down (`overflow-y-auto`, such as the
 * shell's content area), is wider than it shows, in pixels. Tables and calendars that scroll
 * sideways on purpose say `overflow-x-auto` and are not looked at.
 */
const horizontalOverflow = extract((state) => {
  let widest = 0
  for (const element of state.document.querySelectorAll('html, .overflow-y-auto')) {
    if (element.matches('.overflow-x-auto')) continue
    widest = Math.max(widest, element.scrollWidth - element.clientWidth)
  }
  return widest
})

// At desktop and phone width (`--width 375 --height 812`); for up to a second it is allowed, as
// while the sidebar opens or closes.
export const noHorizontalScroll = always(
  eventually(() => horizontalOverflow.current <= 0).within(1, 'seconds'),
)

// Actions: Bombadil's defaults, plus now and then waiting for whatever is loading. The boot
// screen offers nothing to click, so there waiting is the only action.
const onLoginPage = extract((state) => state.window.location.pathname === '/login')
const booting = extract((state) => state.document.getElementById('boot') !== null)

export const explore = weighted([
  [100, clicks],
  [100, inputs],
  [50, scroll],
  [10, back],
  [1, forward],
  [1, reload],
  [10, actions(() => (loaders.current > 0 ? [settle()] : []))],
]).when(() => !onLoginPage.current && !booting.current)

export const boot = actions(() => (booting.current ? [settle()] : []))

// Random clicks sign out now and then. Signing back in, rather than exploring the login form,
// keeps the run on the app.
const signBackIn = registerCustomAction('signBackIn', async (_document, window) => {
  await window.fetch('/auth/password/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: account.email, password: account.password }),
  })
  window.location.assign('/')
})

export const resume = actions(() => (onLoginPage.current ? [signBackIn()] : []))
