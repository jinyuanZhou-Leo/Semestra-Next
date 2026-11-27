import { lmsAnnouncementUnreadOptions } from '@semestra/api-client/react-query'
import type { QueryClient } from '@tanstack/react-query'
import type { Scope } from '@/app/extensions'
import { programLinksOptions } from '../open-in-canvas'

/** The Program's unread announcements per course (one request for all its courses). */
export const unreadOptions = (programId: string) =>
  lmsAnnouncementUnreadOptions({ path: { program_id: programId } })

/** `CardContribution.prefetch`: which courses are linked, and their unread announcements. */
export function prefetchCards(scope: Scope, queryClient: QueryClient) {
  void queryClient.prefetchQuery(programLinksOptions(scope.programId))
  void queryClient.prefetchQuery(unreadOptions(scope.programId))
}
