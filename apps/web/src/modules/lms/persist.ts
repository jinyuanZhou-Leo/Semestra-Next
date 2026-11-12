import {
  type AsyncStorage,
  type PersistedQuery,
  experimental_createQueryPersister,
} from '@tanstack/query-persist-client-core'
import type { QueryClient } from '@tanstack/react-query'
import { type UseStore, clear, createStore, del, entries, get, set } from 'idb-keyval'

/** How long a course's platform reads are kept in the browser after they were last fetched. */
const MAX_AGE = 14 * 24 * 60 * 60 * 1000
/** The account the kept reads belong to; persisted queries are stored under `lms-<hash>`. */
const OWNER = 'owner'

// Opened on first use: importing this must not touch IndexedDB.
let db: UseStore | null = null
function store(): UseStore {
  db ??= createStore('semestra-lms', 'queries')
  return db
}

// Settles once the signed-in account owns the store; until then nothing is read or written.
let owned: Promise<boolean> | null = null
async function ready(): Promise<UseStore | null> {
  return (await owned) ? store() : null
}

/** IndexedDB holds the query as it is (structured clone), so there is nothing to serialize. */
const storage: AsyncStorage<PersistedQuery> = {
  getItem: async (key) => {
    const s = await ready()
    return s ? get(key, s) : undefined
  },
  setItem: async (key, value) => {
    const s = await ready()
    if (s) await set(key, value, s)
  },
  removeItem: async (key) => {
    const s = await ready()
    if (s) await del(key, s)
  },
  entries: async () => {
    const s = await ready()
    return s ? entries<string, PersistedQuery>(s) : []
  },
}

const persister = experimental_createQueryPersister<PersistedQuery>({
  storage: typeof indexedDB === 'undefined' ? null : storage,
  maxAge: MAX_AGE,
  // A release may change a read's shape: what an older version kept is dropped, not shown.
  buster: SEMESTRA_VERSION,
  prefix: 'lms',
  serialize: (query) => ({
    ...query,
    // Only the data and when it was read: a failed refetch is not worth keeping.
    state: { ...query.state, error: null, fetchFailureReason: null, fetchMeta: null },
  }),
  deserialize: (query) => query,
})

/** The reads the Canvas tab shows (M16), by generated operation id. */
const KEPT_READS = [
  'lmsCourseOverview',
  'lmsAnnouncementList',
  'lmsAssignmentList',
  'lmsQuizList',
  'lmsSubmissionGet',
  'lmsModuleList',
  'lmsModuleItemList',
  'lmsPageList',
  'lmsPageGet',
  'lmsSyllabusGet',
  'lmsFolderGet',
]

/**
 * Keeps the Canvas tab's reads in the browser (M16 §4): a view opened again shows what it showed
 * last time at once and fetches the platform's current state behind it. Declared as query
 * defaults, so every component reading the same data (cards, pickers) keeps the same copy.
 */
export function keepLmsReads(queryClient: QueryClient): void {
  for (const id of KEPT_READS) {
    queryClient.setQueryDefaults([{ _id: id }], { persister: persister.persisterFn })
  }
}

/**
 * Called once the signed-in account is known: reads kept for another account are deleted
 * before anything is restored, and expired ones are dropped.
 */
export function claimLmsCache(userId: string): void {
  if (typeof indexedDB === 'undefined') return
  owned = (async () => {
    const s = store()
    if ((await get<string>(OWNER, s)) !== userId) {
      await clear(s)
      await set(OWNER, userId, s)
    }
    return true
  })().catch(() => false) // private windows may refuse IndexedDB: nothing is kept then
  void persister.persisterGc().catch(() => undefined)
}

/** Deletes every kept LMS read (on sign-out). */
export async function forgetLmsCache(): Promise<void> {
  owned = null
  if (typeof indexedDB === 'undefined') return
  await clear(store()).catch(() => undefined)
}
