import {
  type AsyncStorage,
  type PersistedQuery,
  experimental_createQueryPersister,
} from '@tanstack/query-persist-client-core'
import type { QueryClient } from '@tanstack/react-query'
import { type UseStore, clear, createStore, del, entries, get, set } from 'idb-keyval'
import type { KeptQueryMatch } from './extensions'

/**
 * Reads kept in the browser between visits. A module names them in its manifest (`keptQueries`):
 * a view opened again shows what it showed last time at once and fetches the current state behind
 * it. They are declared as query defaults, so every component reading the same data (pages,
 * cards, pickers) shares the kept copy. Kept reads belong to one account, and are dropped when
 * what they describe is replaced by something else (`dropKeptQueries`).
 */

/** How long a read is kept after it was last fetched. */
const MAX_AGE = 14 * 24 * 60 * 60 * 1000
/** The account the kept reads belong to; persisted queries are stored under `kept-<hash>`. */
const OWNER = 'owner'

// Opened on first use: importing this must not touch IndexedDB.
let db: UseStore | null = null
function store(): UseStore {
  db ??= createStore('semestra-kept-queries', 'queries')
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
  prefix: 'kept',
  serialize: (query) => ({
    ...query,
    // Only the data and when it was read: a failed refetch is not worth keeping.
    state: { ...query.state, error: null, fetchFailureReason: null, fetchMeta: null },
  }),
  deserialize: (query) => query,
})

/** Keeps the reads of these operations (generated operation ids), once at startup. */
export function keepQueries(queryClient: QueryClient, operations: readonly string[]): void {
  for (const id of operations) {
    queryClient.setQueryDefaults([{ _id: id }], { persister: persister.persisterFn })
  }
}

/**
 * Called once the signed-in account is known: reads kept for another account are deleted
 * before anything is restored, and expired ones are dropped.
 */
export function claimKeptQueries(userId: string): void {
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

/** Deletes every kept read (on sign-out). */
export async function forgetKeptQueries(): Promise<void> {
  owned = null
  if (typeof indexedDB === 'undefined') return
  await clear(store()).catch(() => undefined)
}

/**
 * Drops the reads of `operations` that match (`{ path: { course_id } }`; `{}` is all of them):
 * the kept copies are deleted and the queries start over, so views on screen load anew and the
 * rest show nothing old when opened. For when a read stopped describing the same thing, e.g. a
 * course linked to another one on its platform; data that merely changed is refetched instead.
 */
export async function dropKeptQueries(
  queryClient: QueryClient,
  operations: readonly string[],
  matches: readonly KeptQueryMatch[],
): Promise<void> {
  const keys = operations.flatMap((id) => matches.map((match) => [{ ...match, _id: id }]))
  // The kept copies go first: a query that starts over before that is restored from its copy.
  await Promise.all(
    keys.map((queryKey) => persister.removeQueries({ queryKey }).catch(() => undefined)),
  )
  await Promise.all(keys.map((queryKey) => queryClient.resetQueries({ queryKey })))
}
