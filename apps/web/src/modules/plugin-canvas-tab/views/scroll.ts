import { useEffect, useRef } from 'react'

/** A ref for the row `key` points at; the row is scrolled into view when `key` changes. */
export function useScrollIntoView<T extends HTMLElement>(key: string | undefined) {
  const ref = useRef<T | null>(null)
  useEffect(() => {
    if (key) ref.current?.scrollIntoView?.({ block: 'nearest' })
  }, [key])
  return ref
}
