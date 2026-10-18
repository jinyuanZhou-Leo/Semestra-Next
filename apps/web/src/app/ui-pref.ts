import { type JsonValue, settingsUiStateGetMany, settingsUiStateSet } from '@semestra/api-client'
import { type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'

/**
 * UI state that survives a reload and follows the user across devices, such as a table's sort
 * order or a collapsed panel (M00 §4.7, M11 §5.5). Stored in `settings_ui_state`; it is not a
 * setting and never appears on a settings page.
 *
 * Reads share the TanStack Query cache (one entry per key). Keys requested in the same tick are
 * fetched in a single request, and the common prefixes are prefetched when the signed-in layout
 * loads. Writes update the cache at once and are sent 300 ms after the last change.
 */

const WRITE_DELAY_MS = 300
const MAX_KEYS_PER_REQUEST = 200
export const UI_PREF_PREFETCH_PREFIXES = [
  'layout.',
  'calendar.',
  'tasks.',
  'academics.',
  'onboarding.',
  'commands.',
] as const

type Entry = { found: boolean; value: unknown }

type Waiter = { resolve: (entry: Entry) => void; reject: (error: unknown) => void }

type Store = {
  /** Values changed locally and not yet saved: they win over whatever the server says. */
  pending: Map<string, unknown>
  timers: Map<string, ReturnType<typeof setTimeout>>
  /** How often each key was written here; tells a refresh that a newer change happened meanwhile. */
  writes: Map<string, number>
  /** The save in progress per key: the next one for the same key waits for it. */
  inflight: Map<string, Promise<void>>
  /** Reads queued for the next batch. */
  waiting: Map<string, Waiter[]>
  batchScheduled: boolean
  prefetch: Promise<void> | null
  prefetchedPrefixes: readonly string[]
}

const stores = new WeakMap<QueryClient, Store>()

function storeOf(queryClient: QueryClient): Store {
  let store = stores.get(queryClient)
  if (!store) {
    store = {
      pending: new Map(),
      timers: new Map(),
      writes: new Map(),
      inflight: new Map(),
      waiting: new Map(),
      batchScheduled: false,
      prefetch: null,
      prefetchedPrefixes: [],
    }
    stores.set(queryClient, store)
    window.addEventListener('pagehide', () => flushUiPrefs(queryClient))
  }
  return store
}

const queryKeyFor = (key: string) => ['ui-pref', key] as const

async function sendBatch(queryClient: QueryClient) {
  const store = storeOf(queryClient)
  const batch = [...store.waiting]
  store.waiting.clear()
  store.batchScheduled = false
  for (let i = 0; i < batch.length; i += MAX_KEYS_PER_REQUEST) {
    const chunk = batch.slice(i, i + MAX_KEYS_PER_REQUEST)
    try {
      const { data } = await settingsUiStateGetMany({
        body: { keys: chunk.map(([key]) => key) },
        throwOnError: true,
      })
      for (const [key, waiters] of chunk) {
        for (const w of waiters) w.resolve({ found: key in data.items, value: data.items[key] })
      }
    } catch (error) {
      for (const [, waiters] of chunk) for (const w of waiters) w.reject(error)
    }
  }
}

async function load(queryClient: QueryClient, key: string): Promise<Entry> {
  const store = storeOf(queryClient)
  await store.prefetch
  if (store.pending.has(key)) return { found: true, value: store.pending.get(key) }
  const cached = queryClient.getQueryData<Entry>(queryKeyFor(key))
  if (cached) return cached
  // The prefetch listed every stored key under its prefixes: a key it did not return is unset.
  if (store.prefetchedPrefixes.some((prefix) => key.startsWith(prefix))) {
    return { found: false, value: undefined }
  }
  return new Promise<Entry>((resolve, reject) => {
    store.waiting.set(key, [...(store.waiting.get(key) ?? []), { resolve, reject }])
    // Everything requested during this tick goes out together.
    if (!store.batchScheduled) {
      store.batchScheduled = true
      setTimeout(() => void sendBatch(queryClient), 0)
    }
  })
}

/** Fetch all keys under `prefixes` once; start it before the first screen renders. */
export function prefetchUiPrefs(
  queryClient: QueryClient,
  prefixes: readonly string[] = UI_PREF_PREFETCH_PREFIXES,
): Promise<void> {
  const store = storeOf(queryClient)
  store.prefetch = (async () => {
    try {
      const { data } = await settingsUiStateGetMany({
        body: { prefixes: [...prefixes] },
        throwOnError: true,
      })
      for (const [key, value] of Object.entries(data.items)) {
        if (!store.pending.has(key)) {
          queryClient.setQueryData<Entry>(queryKeyFor(key), { found: true, value })
        }
      }
      store.prefetchedPrefixes = prefixes
    } catch {
      // Individual reads will try again; nothing depends on the prefetch.
    }
  })()
  return store.prefetch
}

async function send(queryClient: QueryClient, key: string) {
  const store = storeOf(queryClient)
  if (!store.pending.has(key)) return
  const value = store.pending.get(key)
  try {
    await settingsUiStateSet({
      path: { key },
      body: { value: value as JsonValue },
      throwOnError: true,
    })
  } catch {
    // Not worth interrupting anyone for a sort order. The value stays in this tab's cache.
  } finally {
    if (store.pending.get(key) === value) store.pending.delete(key)
  }
}

/** Saves the key's pending value, after the save already in progress for it (if any). */
async function save(queryClient: QueryClient, key: string) {
  const store = storeOf(queryClient)
  clearTimeout(store.timers.get(key))
  store.timers.delete(key)
  // One request per key at a time, so the newest value is always the one the server ends with.
  const run = (store.inflight.get(key) ?? Promise.resolve()).then(() => send(queryClient, key))
  store.inflight.set(key, run)
  await run
  if (store.inflight.get(key) === run) store.inflight.delete(key)
}

/** Send every change that is still waiting for its delay (leaving the page, sign-out). */
export function flushUiPrefs(queryClient: QueryClient): Promise<void[]> {
  const store = storeOf(queryClient)
  return Promise.all([...store.pending.keys()].map((key) => save(queryClient, key)))
}

/**
 * Re-reads keys from the server, for state that other tabs or devices may have changed (a timer
 * shown in two tabs). A value this tab changed and has not saved yet is kept.
 */
export async function refreshUiPrefs(
  queryClient: QueryClient,
  keys: readonly string[],
): Promise<void> {
  const store = storeOf(queryClient)
  const stale = keys.filter((key) => !store.pending.has(key))
  if (stale.length === 0) return
  const before = new Map(stale.map((key) => [key, store.writes.get(key) ?? 0]))
  try {
    const { data } = await settingsUiStateGetMany({ body: { keys: stale }, throwOnError: true })
    for (const key of stale) {
      // A change made here while the request was out is newer than the answer, even if it has
      // been saved since.
      if (store.pending.has(key) || (store.writes.get(key) ?? 0) !== before.get(key)) continue
      const found = key in data.items
      queryClient.setQueryData<Entry>(queryKeyFor(key), {
        found,
        value: found ? data.items[key] : undefined,
      })
    }
  } catch {
    // The cached value stays; the next focus tries again.
  }
}

function write(queryClient: QueryClient, key: string, value: unknown) {
  const store = storeOf(queryClient)
  store.pending.set(key, value)
  store.writes.set(key, (store.writes.get(key) ?? 0) + 1)
  queryClient.setQueryData<Entry>(queryKeyFor(key), { found: true, value })
  clearTimeout(store.timers.get(key))
  store.timers.set(
    key,
    setTimeout(() => void save(queryClient, key), WRITE_DELAY_MS),
  )
}

/**
 * Changes a key that no mounted hook owns (state of another card, say): `change` gets the current
 * value (undefined when nothing is stored) and returns the new one, or undefined to leave it.
 */
export async function updateUiPref<T>(
  queryClient: QueryClient,
  key: string,
  change: (current: T | undefined) => T | undefined,
): Promise<void> {
  try {
    const entry = await load(queryClient, key)
    const next = change(entry.found ? (entry.value as T) : undefined)
    if (next !== undefined) write(queryClient, key, next)
  } catch {
    // The value could not be read; leave the key as it is.
  }
}

/**
 * `const [sort, setSort] = useUiPref('tasks.sort', 'due')`. Key naming: `<module>.<what>`,
 * plus `.<scopeId>` for per-scope state (pass `scope` to append it). The default is used while
 * loading and when nothing has been saved.
 */
export function useUiPref<T>(
  key: string,
  defaultValue: T,
  options: { scope?: string } = {},
): [T, (value: T) => void] {
  const queryClient = useQueryClient()
  const fullKey = options.scope ? `${key}.${options.scope}` : key
  const { data } = useQuery({
    queryKey: queryKeyFor(fullKey),
    queryFn: () => load(queryClient, fullKey),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  })
  const set = useCallback((value: T) => write(queryClient, fullKey, value), [queryClient, fullKey])
  return [data?.found ? (data.value as T) : defaultValue, set]
}
