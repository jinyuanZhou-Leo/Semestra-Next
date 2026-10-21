import { useRouterState } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

/** Fast switches finish before this, so the bar only shows when loading is noticeable. */
const SHOW_AFTER_MS = 150

/**
 * A thin bar along the top while the router waits for the next page's code: the current page
 * stays on screen until then (see `preloadPage`), so this is what shows the click was taken. It
 * floats over the page and never changes the layout. Decorative: the page that opens is what
 * assistive technology announces.
 */
export function NavigationProgress() {
  // The location being loaded, if any; the bar belongs to that navigation only.
  const pending = useRouterState({
    select: (state) => (state.status === 'pending' ? state.location.href : null),
  })
  const [shownFor, setShownFor] = useState<string | null>(null)
  useEffect(() => {
    if (pending === null) return
    const timer = setTimeout(() => setShownFor(pending), SHOW_AFTER_MS)
    return () => clearTimeout(timer)
  }, [pending])
  if (pending === null || shownFor !== pending) return null
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden"
    >
      <div className="h-full w-2/5 animate-navigation-progress bg-primary motion-reduce:animate-pulse" />
    </div>
  )
}
