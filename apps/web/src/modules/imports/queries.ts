import {
  type ImportSessionDetail,
  type ImportsItemUpdateData,
  importsItemUpdate,
} from '@semestra/api-client'
import {
  importsSessionGetOptions,
  importsSessionGetQueryKey,
  importsSessionListOptions,
} from '@semestra/api-client/react-query'
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

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

/** Field edits still being saved; a commit waits for them so it writes what the review shows. */
const pendingEdits = new Set<Promise<unknown>>()

export function trackEdit(edit: Promise<unknown>) {
  pendingEdits.add(edit)
  void edit.finally(() => pendingEdits.delete(edit))
}

export async function settleEdits() {
  await Promise.allSettled([...pendingEdits])
}

/** Saves of one session, one after another: a slow answer can never overwrite a later edit. */
const queues = new Map<string, Promise<unknown>>()

function queued<T>(sessionId: string, run: () => Promise<T>): Promise<T> {
  const next = (queues.get(sessionId) ?? Promise.resolve()).then(run, run)
  const done = () => {
    if (queues.get(sessionId) === next) queues.delete(sessionId)
  }
  queues.set(sessionId, next)
  next.then(done, done)
  return next
}

/**
 * The answer to an edit carries the session and only the items it touched (the edited one and
 * those whose decision or issues changed); the others stay as they are in the cache.
 */
function storeTouched(queryClient: QueryClient, session: ImportSessionDetail) {
  const touched = new Map(session.items.map((item) => [item.id, item]))
  queryClient.setQueryData<ImportSessionDetail>(
    importsSessionGetQueryKey({ path: { session_id: session.id } }),
    (current) =>
      current
        ? { ...session, items: current.items.map((item) => touched.get(item.id) ?? item) }
        : undefined,
  )
}

type ItemEdit = Pick<ImportsItemUpdateData, 'path'> & {
  body: Omit<ImportsItemUpdateData['body'], 'only_touched'>
}

/** `imports.item.update` for the review: queued per session and merged into the cached one. */
export function useItemUpdate({ onError }: { onError?: (error: unknown) => void } = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ path, body }: ItemEdit) =>
      queued(path.session_id, async () => {
        const { data } = await importsItemUpdate({
          path,
          body: { ...body, only_touched: true },
          throwOnError: true,
        })
        return data
      }),
    onError,
    onSuccess: (session) => storeTouched(queryClient, session),
  })
}
