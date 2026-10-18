import { useCallback, useState } from 'react'

const PREFIX = 'semestra.ui.'

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

/**
 * UI state that survives a reload, such as a table's sort order (M00 §4.7). Stored in
 * localStorage until M11 provides the server-side UI preferences API; the signature stays.
 */
export function useUiPref<T>(key: string, defaultValue: T): [T, (value: T) => void] {
  const [value, setValue] = useState(() => read(key, defaultValue))
  const update = useCallback(
    (next: T) => {
      setValue(next)
      try {
        localStorage.setItem(PREFIX + key, JSON.stringify(next))
      } catch {
        // Storage full or blocked: keep the in-memory value.
      }
    },
    [key],
  )
  return [value, update]
}
