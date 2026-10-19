import type { ImportSessionDetail } from '@semestra/api-client'
import {
  importsSessionGetOptions,
  importsSessionGetQueryKey,
  importsSessionListOptions,
} from '@semestra/api-client/react-query'
import { type QueryClient, useQuery } from '@tanstack/react-query'

/** Polls while the session is extracting (the job's SSE progress also refetches it). */
export function useImportSession(sessionId: string | null) {
  return useQuery({
    ...importsSessionGetOptions({ path: { session_id: sessionId ?? '' } }),
    enabled: Boolean(sessionId),
    refetchInterval: (query) => (query.state.data?.status === 'extracting' ? 2000 : false),
  })
}

export function useImportHistory(programId: string) {
  return useQuery(importsSessionListOptions({ path: { program_id: programId } }))
}

/** Every write returns the whole session; keep the cache in step without refetching. */
export function storeSession(queryClient: QueryClient, session: ImportSessionDetail) {
  queryClient.setQueryData(importsSessionGetQueryKey({ path: { session_id: session.id } }), session)
}

/**
 * After a commit the courses, gradebooks, schedules and tasks it wrote are stale. Refetching every
 * active query is simpler than listing every module's keys, and a commit is rare.
 */
export async function invalidateAfterCommit(queryClient: QueryClient) {
  await queryClient.invalidateQueries()
}
