import { useEffect, useState } from 'react'

/** `value`, once it has stopped changing for `delay` ms (search boxes); at once when `delay` is 0. */
export function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return delay === 0 ? value : debounced
}
