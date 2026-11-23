import { lmsCourseOverviewOptions } from '@semestra/api-client/react-query'
import type { QueryClient } from '@tanstack/react-query'
import type { Scope } from '@/app/extensions'
import { cachedUiPref } from '@/app/ui-pref'
import { canvasLocation, type CanvasLocation } from './navigation'
import { placeQueries } from './queries'

/**
 * The Canvas tab's prefetch (M10 pages): the course's overview and, alongside it, what the view
 * the tab opens on reads, so the view doesn't wait for the overview before asking. The place is
 * chosen as the page chooses it (`canvasLocation`): the link's `?tab=&ref=`, else where the user
 * left the tab (M16 §3). The home view needs the overview first. A hovered link only starts the
 * overview.
 */
export function prefetchCanvasPage(
  scope: Scope,
  queryClient: QueryClient,
  { preload, search }: { preload: boolean; search?: Record<string, unknown> },
) {
  if (scope.kind !== 'course') return
  const courseId = scope.courseId
  const options = lmsCourseOverviewOptions({ path: { course_id: courseId } })
  const overview = queryClient.prefetchQuery(options)
  if (preload) return
  const saved = cachedUiPref<CanvasLocation>(queryClient, `canvas-tab.location.${courseId}`)
  const place = canvasLocation(search ?? {}, saved ?? null)
  const start = () => {
    const shown = queryClient.getQueryData(options.queryKey)
    for (const prefetch of placeQueries(courseId, place, shown)) void prefetch(queryClient)
  }
  if (place.tab === 'home') void overview.then(start)
  else start()
}
