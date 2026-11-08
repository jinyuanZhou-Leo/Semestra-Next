import type { Course } from '@semestra/api-client'
import { academicsCourseGetOptions } from '@semestra/api-client/react-query'
import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import type { PageContribution, Scope } from '@/app/extensions'
import { useHotkey } from '@/app/hotkeys'
import { usePreferences } from '@/app/preferences'
import { useModules } from '@/app/registry'
import { m } from '@/paraglide/messages'
import { coursePath } from '../paths'
import { coursePage } from './course-tab'

const THROTTLE_MS = 150

/** What a page's `availabilityQuery` has cached for `scope`; not loaded yet counts as unavailable. */
function availabilityData(queryClient: QueryClient, page: PageContribution, scope: Scope) {
  const query = page.availabilityQuery?.(scope)
  return query ? queryClient.getQueryData(query.queryKey) : undefined
}

/**
 * `Cmd/Ctrl + ↑/↓` on a course page opens the previous/next course of the same term, on the
 * current tab while the "keep the course tab" preference is on and the target course has that
 * tab, otherwise on its overview (M02 §5.1). A held
 * key switches at most every 150 ms; the target's data is fetched before navigating.
 */
export function useCourseSwitchHotkey({
  programId,
  courseId,
  termId,
  pageId,
  courses,
}: {
  programId: string
  courseId: string
  termId: string | undefined
  pageId: string
  courses: readonly Course[]
}) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const modules = useModules()
  const last = useRef(0)
  const keep = usePreferences().data?.keep_course_tab ?? true

  // Fetch the neighbours ahead of time so the switch shows data at once.
  const index = courses.findIndex((c) => c.id === courseId)
  const prevId = index > 0 ? courses[index - 1]?.id : undefined
  const nextId = index >= 0 ? courses[index + 1]?.id : undefined
  useEffect(() => {
    for (const id of [prevId, nextId]) {
      if (id) void queryClient.prefetchQuery(academicsCourseGetOptions({ path: { course_id: id } }))
    }
  }, [queryClient, prevId, nextId])

  useHotkey(
    'mod+up, mod+down',
    (event) => {
      const now = performance.now()
      if (now - last.current < THROTTLE_MS) return
      last.current = now
      const target = courses[index + (event.key === 'ArrowDown' ? 1 : -1)]
      if (!target) return
      const scope: Scope = { kind: 'course', programId, courseId: target.id }
      const tab = keep && pageId !== 'overview' ? pageId : undefined
      const contribution = tab
        ? coursePage(
            modules.flatMap((module) => module.pages ?? []),
            tab,
          )
        : undefined
      const page =
        contribution &&
        (contribution.isAvailable?.(scope, availabilityData(queryClient, contribution, scope)) ??
          true)
          ? tab
          : undefined
      void queryClient.prefetchQuery(academicsCourseGetOptions({ path: { course_id: target.id } }))
      router.history.push(coursePath(programId, target.id, page, termId))
    },
    {
      description: m.hotkeys_switch_course,
      order: 50,
      // Not a course of the list: the arrows keep their usual meaning.
      ignoreEventWhen: () => index < 0,
    },
  )
}
