import type { Course } from '@semestra/api-client'
import { academicsCourseGetOptions } from '@semestra/api-client/react-query'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import type { Scope } from '@/app/extensions'
import { useListedHotkey } from '@/app/hotkeys'
import { useModules } from '@/app/registry'
import { m } from '@/paraglide/messages'
import { coursePath } from '../paths'

const THROTTLE_MS = 150

/** ⌘ on Apple keyboards, Ctrl elsewhere: the modifier of the course-switch shortcut. */
export function modifierKey(): string {
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform ??
    ''
  return /mac|iphone|ipad/i.test(platform) ? '⌘' : 'Ctrl'
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)
}

/**
 * `Cmd/Ctrl + ↑/↓` on a course page opens the previous/next course of the same term and keeps
 * the current page, or the overview when the target course has no such page (M02 §5.1). A held
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
  useListedHotkey('mod+up, mod+down', m.hotkeys_switch_course, { order: 50 })
  const latest = useRef({ programId, courseId, termId, pageId, courses, modules })
  useEffect(() => {
    latest.current = { programId, courseId, termId, pageId, courses, modules }
  })

  // Fetch the neighbours ahead of time so the switch shows data at once.
  const index = courses.findIndex((c) => c.id === courseId)
  const prevId = index > 0 ? courses[index - 1]?.id : undefined
  const nextId = index >= 0 ? courses[index + 1]?.id : undefined
  useEffect(() => {
    for (const id of [prevId, nextId]) {
      if (id) void queryClient.prefetchQuery(academicsCourseGetOptions({ path: { course_id: id } }))
    }
  }, [queryClient, prevId, nextId])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
      if (isEditable(event.target)) return
      const s = latest.current
      const position = s.courses.findIndex((c) => c.id === s.courseId)
      if (position < 0) return
      event.preventDefault()
      const now = performance.now()
      if (now - last.current < THROTTLE_MS) return
      last.current = now
      const target = s.courses[position + (event.key === 'ArrowDown' ? 1 : -1)]
      if (!target) return
      const scope: Scope = { kind: 'course', programId: s.programId, courseId: target.id }
      const hasPage = s.modules
        .flatMap((module) => module.pages ?? [])
        .some(
          (page) =>
            page.id === s.pageId &&
            page.scopes.includes('course') &&
            (page.isAvailable?.(scope) ?? true),
        )
      const page = hasPage && s.pageId !== 'overview' ? s.pageId : undefined
      void queryClient.prefetchQuery(academicsCourseGetOptions({ path: { course_id: target.id } }))
      router.history.push(coursePath(s.programId, target.id, page, s.termId))
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [router, queryClient])
}
