import { useEffect, useRef, useState } from 'react'
import { type SaveStatus, useReportSectionStatus } from './status'

const SAVED_VISIBLE_MS = 2000

type Options<P> = {
  /** Sends one merged patch. A rejection puts the patch back and shows "Retry". */
  save: (patch: P) => Promise<unknown>
  /** Wait after the last change before saving (M11 §5.1: 600 ms for typing). */
  delay?: number
}

/**
 * Debounced auto-save (M11 §5.1). `queue(patch)` merges changes; one request goes out after
 * `delay` of quiet, never two at once. Pending changes are flushed when the component unmounts
 * and when the page is hidden, so leaving the page does not lose them.
 */
export function useAutosave<P extends Record<string, unknown>>({ save, delay = 600 }: Options<P>) {
  const report = useReportSectionStatus()
  const [status, setStatusState] = useState<SaveStatus>('idle')
  const state = useRef({
    pending: {} as Partial<P>,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
    fade: undefined as ReturnType<typeof setTimeout> | undefined,
    running: false,
    save,
    report,
  })
  // Always call the latest closures, from timers that outlive a render.
  useEffect(() => {
    state.current.save = save
    state.current.report = report
  })

  const setStatus = (next: SaveStatus) => {
    setStatusState(next)
    state.current.report({ status: next, retry: next === 'error' ? () => void run() : undefined })
  }

  async function run(): Promise<void> {
    const s = state.current
    clearTimeout(s.timer)
    s.timer = undefined
    if (s.running || Object.keys(s.pending).length === 0) return
    s.running = true
    const patch = s.pending
    s.pending = {}
    clearTimeout(s.fade)
    setStatus('saving')
    try {
      await s.save(patch as P)
    } catch {
      // Newer edits of the same field win over the failed value.
      s.pending = { ...patch, ...s.pending }
      s.running = false
      setStatus('error')
      return
    }
    s.running = false
    if (Object.keys(s.pending).length > 0) {
      await run()
      return
    }
    setStatus('saved')
    s.fade = setTimeout(() => setStatus('idle'), SAVED_VISIBLE_MS)
  }

  function queue(patch: Partial<P>) {
    const s = state.current
    s.pending = { ...s.pending, ...patch }
    clearTimeout(s.timer)
    s.timer = setTimeout(() => void run(), delay)
  }

  useEffect(() => {
    const s = state.current
    const onHide = () => void run()
    window.addEventListener('pagehide', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
      clearTimeout(s.fade)
      void run()
    }
  }, [])

  return { queue, flush: run, status }
}
