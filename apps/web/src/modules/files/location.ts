import type { ItemOut } from '@semestra/api-client'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useState } from 'react'
import { coursePath } from '@/modules/academics/paths'
import type { PreviewTarget } from './components/PreviewDialog'

/**
 * Where a files page is, kept in its URL so that back, forward and reload return there and other
 * places can link to it (M07 §6.1): `folder` is the folder shown, `file` the file previewed, and
 * on a term page `course` is the course opened. A missing one is the top level, or no preview.
 */
type Place = { course: string | null; folder: string | null; file: string | null }

/** A course's files page, at a folder and with a file previewed. */
export function courseFilesPath(
  programId: string,
  courseId: string,
  at: { folderId?: string | null; itemId?: string | null } = {},
) {
  const query = new URLSearchParams()
  if (at.folderId) query.set('folder', at.folderId)
  if (at.itemId) query.set('file', at.itemId)
  const search = query.toString()
  return `${coursePath(programId, courseId, 'files')}${search ? `?${search}` : ''}`
}

/** A file previewed on its course's files page, in the folder it is in. */
export function filePath(programId: string, item: Pick<ItemOut, 'id' | 'course_id' | 'folder_id'>) {
  return courseFilesPath(programId, item.course_id, { folderId: item.folder_id, itemId: item.id })
}

const text = (value: unknown) => (typeof value === 'string' && value ? value : null)

/** The page's other search params (`fromTerm`, `organize`) are kept. */
function moved(prev: Record<string, string | undefined>, next: Partial<Place>) {
  const search = { ...prev }
  for (const [key, value] of Object.entries(next)) {
    if (value) search[key] = value
    else delete search[key]
  }
  return search
}

export type FilesLocation = Place & {
  /** Goes somewhere: a new history entry, or `replace` when correcting a place that is gone. */
  go: (next: Partial<Place>, opts?: { replace?: boolean }) => void
}

export function useFilesLocation(): FilesLocation {
  const search = useSearch({ strict: false }) as Record<string, unknown>
  const navigate = useNavigate()
  return {
    course: text(search.course),
    folder: text(search.folder),
    file: text(search.file),
    go: (next, opts) =>
      void navigate({
        to: '.',
        search: (prev: Record<string, string | undefined>) => moved(prev, next),
        replace: opts?.replace,
      }),
  }
}

const samePreview = (a: PreviewTarget | null, b: PreviewTarget | null) =>
  a?.itemId === b?.itemId && a?.page === b?.page && a?.terms === b?.terms

/**
 * The preview of the file in the URL, shaped like `useDialogTarget` for `PreviewDialog`. A search
 * hit's page and words are not part of the address: they stay with the file they were opened for.
 * The file is kept while the dialog fades out after it has left the URL.
 */
export function usePreviewLocation(location: FilesLocation) {
  const [opened, setOpened] = useState<PreviewTarget | null>(null)
  const [shown, setShown] = useState<PreviewTarget | null>(null)
  const linked = location.file
    ? opened?.itemId === location.file
      ? opened
      : { itemId: location.file }
    : null
  let target = shown
  if (linked && !samePreview(linked, shown)) {
    setShown(linked)
    target = linked
  }
  return {
    target,
    show: (next: PreviewTarget) => {
      setOpened(next)
      location.go({ file: next.itemId })
    },
    props: {
      open: linked !== null,
      onOpenChange: (open: boolean) => {
        if (!open) location.go({ file: null })
      },
      onOpenChangeComplete: (open: boolean) => {
        if (!open) setShown(null)
      },
    },
  }
}
