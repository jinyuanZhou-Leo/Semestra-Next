import { useSyncExternalStore } from 'react'

/** Whether a media query matches, following changes. False where matchMedia is missing. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window.matchMedia !== 'function') return () => {}
      const list = window.matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    () => typeof window.matchMedia === 'function' && window.matchMedia(query).matches,
    () => false,
  )
}

/**
 * The width of `element` in px, following resizes; 0 until the element is attached. Read during
 * render (unlike react-grid-layout's `useContainerWidth`, which measures in an effect), so the
 * first painted frame already has the right column count.
 */
export function useElementWidth(element: HTMLElement | null): number {
  return useSyncExternalStore(
    (onChange) => {
      if (!element || typeof ResizeObserver === 'undefined') return () => {}
      const observer = new ResizeObserver(onChange)
      observer.observe(element)
      return () => observer.disconnect()
    },
    () => (element ? Math.round(element.getBoundingClientRect().width) : 0),
    () => 0,
  )
}
