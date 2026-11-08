import { type DragEvent as ReactDragEvent, useEffect, useState } from 'react'

function hasFiles(event: { dataTransfer: DataTransfer | null }) {
  return event.dataTransfer?.types.includes('Files') ?? false
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

/** Folders (or course folders) that take files dragged onto them; `over` is the one under them. */
export type DropTargets = {
  over: string | null
  setOver: (key: string | null) => void
  drop: (key: string, files: File[]) => void
}

/**
 * Makes a folder's row or tile a drop target (style it with `DROP_TARGET`). `preventDefault` on
 * the drop tells the page's own drop zone (`useFileDrop`) that the files are taken.
 */
export function dropTargetProps(key: string, targets: DropTargets | undefined) {
  if (!targets) return {}
  return {
    'data-drop-target': targets.over === key ? '' : undefined,
    onDragOver: (event: ReactDragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      targets.setOver(key)
    },
    onDragLeave: (event: ReactDragEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) targets.setOver(null)
    },
    onDrop: (event: ReactDragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      targets.setOver(null)
      targets.drop(key, [...event.dataTransfer.files])
    },
  }
}

/** A drop target with files dragged over it. */
export const DROP_TARGET = 'data-drop-target:bg-primary/10 data-drop-target:text-primary'
