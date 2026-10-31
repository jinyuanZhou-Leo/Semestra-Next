import { useEffect, useState } from 'react'

/** `value`, once it has stopped changing for `delay` ms (search boxes). */
export function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

/**
 * True while files are dragged over the window, and `onDrop` gets them: the whole page is the
 * drop zone (M07 §6.1). A drop that a target inside the page took (a folder, a course section:
 * its handler calls `preventDefault`) is not passed on. Other drags (text, cards on a board) are
 * ignored.
 */
export function useFileDrop(onDrop: (files: File[]) => void, enabled = true): boolean {
  const [over, setOver] = useState(false)
  useEffect(() => {
    if (!enabled) return
    let depth = 0
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false
    const enter = (event: DragEvent) => {
      if (!hasFiles(event)) return
      depth += 1
      setOver(true)
    }
    const leave = (event: DragEvent) => {
      if (!hasFiles(event)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setOver(false)
    }
    const overHandler = (event: DragEvent) => {
      if (hasFiles(event)) event.preventDefault()
    }
    const drop = (event: DragEvent) => {
      if (!hasFiles(event)) return
      const taken = event.defaultPrevented
      event.preventDefault()
      depth = 0
      setOver(false)
      if (!taken) onDrop([...(event.dataTransfer?.files ?? [])])
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', overHandler)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', overHandler)
      window.removeEventListener('drop', drop)
    }
  }, [onDrop, enabled])
  return over
}
