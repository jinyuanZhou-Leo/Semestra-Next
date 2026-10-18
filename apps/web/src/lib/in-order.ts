type Queue = { tail: Promise<unknown>; generation: number }

const queues = new Map<string, Queue>()

/**
 * Runs `run` once every earlier save of `key` has settled, so the server applies them in the
 * order they were made. `isLatest()` says whether a newer save of `key` started meanwhile; only
 * the newest one should write its result or its rollback to the cache.
 */
export function inOrder<T>(key: string, run: () => Promise<T>) {
  let queue = queues.get(key)
  if (!queue) {
    queue = { tail: Promise.resolve(), generation: 0 }
    queues.set(key, queue)
  }
  const current = queue
  const generation = ++current.generation
  const result = current.tail.then(run)
  current.tail = result.catch(() => undefined)
  return { result, isLatest: () => current.generation === generation }
}
