import { useNavigate, useSearch } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useUiPref } from '@/app/ui-pref'
import type { CanvasLocation } from './navigation'

const HOME: CanvasLocation = { tab: 'home' }

function same(a: CanvasLocation | null, b: CanvasLocation | null) {
  return a?.tab === b?.tab && (a?.ref ?? null) === (b?.ref ?? null)
}

/** The page's other search params (`fromTerm`, `settings`...) stay as they are. */
function withLocation(next: CanvasLocation) {
  return (prev: Record<string, unknown>) => {
    const { tab: _tab, ref: _ref, ...rest } = prev
    return { ...rest, tab: next.tab, ...(next.ref ? { ref: next.ref } : {}) }
  }
}

/**
 * Where the user is in a course's Canvas tab (M16 §3): in the URL (`?tab=&ref=`, so it can be
 * shared and survives a reload) and in the UI state `canvas-tab.location.<courseId>`, which
 * brings the user back to the same place when they open the tab again without one.
 */
export function useCanvasLocation(
  courseId: string,
): [CanvasLocation, (next: CanvasLocation) => void] {
  const search = useSearch({ strict: false }) as { tab?: unknown; ref?: unknown }
  const navigate = useNavigate()
  const [saved, save] = useUiPref<CanvasLocation | null>(`canvas-tab.location.${courseId}`, null)
  const fromUrl: CanvasLocation | null =
    typeof search.tab === 'string' && search.tab
      ? {
          tab: search.tab,
          ...(typeof search.ref === 'string' && search.ref ? { ref: search.ref } : {}),
        }
      : null
  const location = fromUrl ?? saved ?? HOME

  const urlTab = fromUrl?.tab
  const urlRef = fromUrl?.ref
  const savedTab = saved?.tab
  const savedRef = saved?.ref
  useEffect(() => {
    // A shared link is remembered too; coming back without one puts the remembered place in the URL.
    if (urlTab) {
      const current = { tab: urlTab, ...(urlRef ? { ref: urlRef } : {}) }
      const previous = savedTab ? { tab: savedTab, ref: savedRef } : null
      if (!same(current, previous)) save(current)
    } else if (savedTab) {
      void navigate({
        to: '.',
        search: withLocation({ tab: savedTab, ref: savedRef }),
        replace: true,
      })
    }
  }, [urlTab, urlRef, savedTab, savedRef, save, navigate])

  const go = (next: CanvasLocation) => {
    if (same(next, location)) return
    save(next)
    void navigate({ to: '.', search: withLocation(next) })
  }
  return [location, go]
}
