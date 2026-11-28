import type { DragEvent as ReactDragEvent } from 'react'
import { hasFiles } from '@/lib/file-drop'

/** Folders (or course folders) that take files dragged onto them; `over` is the one under them. */
export type DropTargets = {
  over: string | null
  setOver: (key: string | null) => void
  drop: (key: string, files: File[]) => void
}

/**
 * Makes a folder's row or tile a drop target (style it with `DROP_TARGET`). `preventDefault` on
 * the drop tells the page's own drop zone (`useFileDrop` in `lib/file-drop.ts`) that the files are taken.
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
