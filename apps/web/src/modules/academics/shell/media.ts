import { useSyncExternalStore } from 'react'

const NARROW = '(max-width: 767px)'

function subscribe(onChange: () => void) {
  if (typeof window.matchMedia !== 'function') return () => {}
  const query = window.matchMedia(NARROW)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

/** Phones (< 768px): the sidebar becomes a drawer and only "Today" stays usable (M02 §5.1). */
export function useIsNarrow(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => typeof window.matchMedia === 'function' && window.matchMedia(NARROW).matches,
    () => false,
  )
}
