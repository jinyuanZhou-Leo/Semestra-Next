import { useCallback, useEffect, useRef, useState } from 'react'

export type AiEvidence = { page?: number | null; quote: string }

export type AiFilled<V> = {
  /** The value the field had before AI filled it, restored by `revert`. */
  previous: V
  evidence?: AiEvidence | null
  confidence?: number
}

/** How long a filled field stays highlighted. */
export const AI_FILL_HIGHLIGHT_MS = 2_000

/**
 * Bookkeeping for AI results filled straight into a form (M06 §7 rule 2): which fields were
 * filled, from what evidence, and what to put back. The form's own save button confirms; there
 * is no extra confirmation step.
 *
 * `fill(field, previous, info)` records a field the caller has just set; `revert(field)` returns
 * the previous value (and forgets the field); `accept(field)` forgets it when the user edits it.
 */
export function useAiFill<F extends string, V = unknown>() {
  const [filled, setFilled] = useState<Partial<Record<F, AiFilled<V>>>>({})
  const [highlighted, setHighlighted] = useState<ReadonlySet<F>>(new Set())
  // Pending "stop highlighting" timers, cleared when the form goes away.
  const timers = useRef(new Set<number>())

  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const timer of pending) window.clearTimeout(timer)
      pending.clear()
    }
  }, [])

  const fill = useCallback((field: F, previous: V, info: Omit<AiFilled<V>, 'previous'> = {}) => {
    setFilled((current) => ({ ...current, [field]: { previous, ...info } }))
    setHighlighted((current) => new Set(current).add(field))
    const timer = window.setTimeout(() => {
      timers.current.delete(timer)
      setHighlighted((current) => {
        const next = new Set(current)
        next.delete(field)
        return next
      })
    }, AI_FILL_HIGHLIGHT_MS)
    timers.current.add(timer)
  }, [])

  const accept = useCallback((field: F) => {
    setFilled((current) => {
      if (!(field in current)) return current
      const next = { ...current }
      delete next[field]
      return next
    })
  }, [])

  const revert = useCallback(
    (field: F): V | undefined => {
      const entry = filled[field]
      accept(field)
      return entry?.previous
    },
    [filled, accept],
  )

  return {
    /** The fill record of a field, if AI filled it and the user has not changed it since. */
    get: (field: F): AiFilled<V> | undefined => filled[field],
    isHighlighted: (field: F) => highlighted.has(field),
    fill,
    accept,
    revert,
  }
}
