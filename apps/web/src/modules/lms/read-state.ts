import type { AnnouncementList, TermAnnouncementList } from '@semestra/api-client'
import { lmsAnnouncementMarkRead } from '@semestra/api-client'
import {
  lmsAnnouncementListQueryKey,
  settingsValueGetOptions,
} from '@semestra/api-client/react-query'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

/**
 * The account setting `lms.allow_writes`: may Semestra change things on the platform (M09).
 * Announcements show as unread only while it is on: the mark is the platform's, and only then
 * does reading an announcement here clear it; with it off the mark would never go away.
 */
export function useWritesAllowed(): boolean {
  const values = useQuery({
    ...settingsValueGetOptions({ path: { namespace: 'lms' } }),
    staleTime: 60_000,
  }).data?.values as { allow_writes?: boolean } | undefined
  return values?.allow_writes ?? false
}

/**
 * Opening an unread announcement marks it read on the platform when the user allowed writes; the
 * course's and the terms' lists (pages, cards, the Canvas tab) drop the mark without refetching.
 */
export function useMarkRead(courseId: string | undefined, id: string | undefined, unread: boolean) {
  const queryClient = useQueryClient()
  const allowed = useWritesAllowed()
  useEffect(() => {
    if (!courseId || !id || !unread || !allowed) return
    lmsAnnouncementMarkRead({
      path: { course_id: courseId, announcement_id: id },
      throwOnError: true,
    }).then(
      () => {
        queryClient.setQueriesData<AnnouncementList>(
          { queryKey: lmsAnnouncementListQueryKey({ path: { course_id: courseId } }) },
          (list) =>
            list && {
              ...list,
              items: list.items.map((a) => (a.external_id === id ? { ...a, unread: false } : a)),
            },
        )
        queryClient.setQueriesData<TermAnnouncementList>(
          { queryKey: [{ _id: 'lmsTermAnnouncementList' }] },
          (list) =>
            list && {
              ...list,
              items: list.items.map((a) =>
                a.course_id === courseId && a.external_id === id ? { ...a, unread: false } : a,
              ),
            },
        )
      },
      // Best effort: the announcement is open either way, and stays unread on the platform.
      () => {},
    )
  }, [courseId, id, unread, allowed, queryClient])
}
