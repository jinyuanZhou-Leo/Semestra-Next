import { useCallback, useEffect, useRef, useState } from 'react'

export type SaveStatus = 'idle' | 'saving' | 'error'

/**
 * Local, instantly applied copy of a card's settings that is saved with a delay (M14 §1, §4:
 * counter 300 ms, sticky note 800 ms). `incoming` is what the server last said; local changes win
 * over it until they are saved. `save` must put the saved values into the query cache before it
 * resolves. A failed save drops the changes it carried and reports `status: 'error'`; edits made
 * while it was in flight are kept and sent on their own.
 * Pending changes are sent when the card unmounts or the page is hidden.
 */
export function useOptimisticSettings<T extends object>(
  incoming: T,
  save: (patch: Partial<T>) => Promise<unknown>,
  delayMs: number,
): { value: T; update: (patch: Partial<T>) => void; flush: () => void; status: SaveStatus } {
  const [pending, setPending] = useState<Partial<T> | null>(null)
  const [status, setStatus] = useState<SaveStatus>('idle')
  const pendingRef = useRef<Partial<T> | null>(null)
  /** Patches handed to `save` (or queued behind one) that have not finished yet, oldest first. */
  const outstanding = useRef<Partial<T>[]>([])
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const saveRef = useRef(save)
  const inflight = useRef<Promise<void>>(Promise.resolve())
  useEffect(() => {
    saveRef.current = save
  })

  // What the card shows over `incoming`: every change that is not saved yet, in order.
  const show = useCallback(() => {
    const unsaved = [...outstanding.current, ...(pendingRef.current ? [pendingRef.current] : [])]
    setPending(unsaved.length > 0 ? Object.assign({}, ...unsaved) : null)
  }, [])

  const send = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = undefined
    const patch = pendingRef.current
    if (!patch) return
    pendingRef.current = null
    outstanding.current.push(patch)
    setStatus('saving')
    // One request at a time, so the newest values are what the server ends with.
    inflight.current = inflight.current.then(async () => {
      let failed = false
      try {
        await saveRef.current(patch)
      } catch {
        failed = true
      }
      // On success `save` has put the values into the query cache, so `incoming` has them; on
      // failure only what this request carried is rolled back. Later edits keep showing.
      outstanding.current = outstanding.current.filter((p) => p !== patch)
      show()
      if (failed) setStatus('error')
      else setStatus(outstanding.current.length > 0 || pendingRef.current ? 'saving' : 'idle')
    })
  }, [show])

  const update = useCallback(
    (patch: Partial<T>) => {
      pendingRef.current = { ...pendingRef.current, ...patch }
      show()
      clearTimeout(timer.current)
      timer.current = setTimeout(send, delayMs)
    },
    [delayMs, send, show],
  )

  useEffect(() => {
    const onHide = () => send()
    window.addEventListener('pagehide', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
      send()
    }
  }, [send])

  return { value: { ...incoming, ...pending }, update, flush: send, status }
}
