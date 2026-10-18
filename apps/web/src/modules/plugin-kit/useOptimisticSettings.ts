import { useCallback, useEffect, useRef, useState } from 'react'

export type SaveStatus = 'idle' | 'saving' | 'error'

/**
 * Local, instantly applied copy of a card's settings that is saved with a delay (M14 §1, §4:
 * counter 300 ms, sticky note 800 ms). `incoming` is what the server last said; local changes win
 * over it until they are saved. `save` must put the saved values into the query cache before it
 * resolves. A failed save drops the local changes again and reports `status: 'error'`.
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
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const saveRef = useRef(save)
  const inflight = useRef<Promise<void>>(Promise.resolve())
  useEffect(() => {
    saveRef.current = save
  })

  const send = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = undefined
    const patch = pendingRef.current
    if (!patch) return
    pendingRef.current = null
    setStatus('saving')
    // One request at a time, so the newest values are what the server ends with.
    inflight.current = inflight.current.then(async () => {
      try {
        await saveRef.current(patch)
        // `save` has put the new values into the query cache, so `incoming` already has them,
        // unless the user changed something again meanwhile.
        if (pendingRef.current) {
          setStatus('saving')
        } else {
          setPending(null)
          setStatus('idle')
        }
      } catch {
        pendingRef.current = null
        setPending(null)
        setStatus('error')
      }
    })
  }, [])

  const update = useCallback(
    (patch: Partial<T>) => {
      const next = { ...pendingRef.current, ...patch }
      pendingRef.current = next
      setPending(next)
      clearTimeout(timer.current)
      timer.current = setTimeout(send, delayMs)
    },
    [delayMs, send],
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
