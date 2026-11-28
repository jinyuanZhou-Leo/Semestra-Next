import { useEffect, useState } from 'react'

export function hasFiles(event: { dataTransfer: DataTransfer | null }) {
  return event.dataTransfer?.types.includes('Files') ?? false
}

/** The MIME types of the files being dragged ('' where the browser does not say). */
function draggedTypes(event: DragEvent): string[] {
  return [...(event.dataTransfer?.items ?? [])]
    .filter((item) => item.kind === 'file')
    .map((item) => item.type)
}

/**
 * While files are dragged over the window, their MIME types ('' where the browser does not say;
 * null when nothing is dragged), and `onDrop` gets them: the whole page is the drop zone (M07
 * §6.1). A drop that a target inside the page took (a folder, a course section: its handler calls
 * `preventDefault`) is not passed on. Other drags (text, cards on a board) are ignored.
 */
export function useFileDrag(
  onDrop: (files: File[]) => void,
  enabled = true,
): readonly string[] | null {
  const [types, setTypes] = useState<readonly string[] | null>(null)
  useEffect(() => {
    if (!enabled) return
    let depth = 0
    const enter = (event: DragEvent) => {
      if (!hasFiles(event)) return
      depth += 1
      if (depth === 1) setTypes(draggedTypes(event))
    }
    const leave = (event: DragEvent) => {
      if (!hasFiles(event)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setTypes(null)
    }
    const overHandler = (event: DragEvent) => {
      if (hasFiles(event)) event.preventDefault()
    }
    const drop = (event: DragEvent) => {
      if (!hasFiles(event)) return
      const taken = event.defaultPrevented
      event.preventDefault()
      depth = 0
      setTypes(null)
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
  return types
}

/** True while files are dragged over the window; `onDrop` gets them (see `useFileDrag`). */
export function useFileDrop(onDrop: (files: File[]) => void, enabled = true): boolean {
  return useFileDrag(onDrop, enabled) !== null
}

/** File types as react-dropzone's `accept` takes them: MIME type → extensions. */
export type Accept = Readonly<Record<string, readonly string[]>>

/**
 * Whether `accept` takes a file, by its MIME type or its extension. A type the browser leaves
 * empty while dragging (`name` absent) counts as taken: the drop checks the file itself.
 */
export function accepts(accept: Accept, file: { type: string; name?: string }): boolean {
  if (file.type && file.type in accept) return true
  if (file.name === undefined) return file.type === ''
  const name = file.name.toLowerCase()
  return Object.values(accept).some((exts) => exts.some((ext) => name.endsWith(ext)))
}
