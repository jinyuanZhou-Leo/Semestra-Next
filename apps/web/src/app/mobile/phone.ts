import { useSyncExternalStore } from 'react'

/**
 * Where a Program opens in the phone shell (M17): below shadcn's `useIsMobile` breakpoint, or a
 * touch screen less than 500px tall, so a phone turned sideways (844–932px wide) stays in it.
 * Unlike that hook it answers on the first render, so a phone never draws the desktop shell
 * first.
 */
export const PHONE_QUERY = '(max-width: 767px), (pointer: coarse) and (max-height: 499px)'

function media(): MediaQueryList | null {
  return typeof window === 'undefined' || !window.matchMedia ? null : window.matchMedia(PHONE_QUERY)
}

export function isPhone(): boolean {
  return media()?.matches ?? false
}

function subscribe(onChange: () => void): () => void {
  const query = media()
  query?.addEventListener('change', onChange)
  return () => query?.removeEventListener('change', onChange)
}

/** Whether the window is phone-sized; follows resizes. */
export function usePhone(): boolean {
  return useSyncExternalStore(subscribe, isPhone, () => false)
}
