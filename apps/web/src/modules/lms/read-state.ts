import type {
  AnnouncementList,
  CourseAnnouncement,
  TermAnnouncementList,
} from '@semestra/api-client'
import { lmsAnnouncementMarkRead } from '@semestra/api-client'
import { lmsAnnouncementListQueryKey } from '@semestra/api-client/react-query'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

/**
 * Opening an unread announcement marks it read (M09 §4.3: in the app, and on the platform when
 * the user allows writes). The course's and the terms' lists (pages, cards, the Canvas tab) drop
 * the mark at once; the 公告 tabs' counts refetch.
 */
export function useMarkRead(courseId: string | undefined, id: string | undefined, unread: boolean) {
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!courseId || !id || !unread) return
    const read = (items: CourseAnnouncement[]) =>
      items.map((a) =>
        a.course_id === courseId && a.external_id === id ? { ...a, unread: false } : a,
      )
    queryClient.setQueriesData<AnnouncementList>(
      { queryKey: lmsAnnouncementListQueryKey({ path: { course_id: courseId } }) },
      (list) => list && { ...list, items: read(list.items) },
    )
    queryClient.setQueriesData<TermAnnouncementList>(
      { queryKey: [{ _id: 'lmsTermAnnouncementList' }] },
      (list) => list && { ...list, items: read(list.items) },
    )
    lmsAnnouncementMarkRead({ path: { course_id: courseId, announcement_id: id } }).then(
      () => queryClient.invalidateQueries({ queryKey: [{ _id: 'lmsAnnouncementUnread' }] }),
      // Best effort: the announcement is open either way; the next refetch shows it unread.
      () => {},
    )
  }, [courseId, id, unread, queryClient])
}
