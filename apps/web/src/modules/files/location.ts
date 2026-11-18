import type { ItemOut } from '@semestra/api-client'
import { useNavigate, useRouter, useSearch } from '@tanstack/react-router'
import { useState } from 'react'
import { coursePath } from '@/modules/academics/paths'
import type { PreviewTarget } from './components/PreviewDialog'

/**
 * Where a files page is, kept in its URL so that back, forward and reload return there and other
 * places can link to it (M07 §6.1). Every search param of the files pages is defined here:
 * `folder` is the folder shown, `file` the file previewed, `organize` has the organizing dialog
 * open (`?organize=true`), and on a term page `course` is the course opened. A missing one is the top
 * level, no preview, or the dialog closed.
 */
type Place = {
  course: string | null
  folder: string | null
  file: string | null
  organize: boolean
}

/** A course's files page, at a folder, with a file previewed or the organizing dialog open. */
export function courseFilesPath(
  programId: string,
  courseId: string,
  at: { folderId?: string | null; itemId?: string | null; organize?: boolean } = {},
) {
  const query = new URLSearchParams()
  if (at.folderId) query.set('folder', at.folderId)
  if (at.itemId) query.set('file', at.itemId)
  if (at.organize) query.set('organize', 'true')
  const search = query.toString()
  return `${coursePath(programId, courseId, 'files')}${search ? `?${search}` : ''}`
}

/** A file previewed on its course's files page, in the folder it is in. */
export function filePath(programId: string, item: Pick<ItemOut, 'id' | 'course_id' | 'folder_id'>) {
  return courseFilesPath(programId, item.course_id, { folderId: item.folder_id, itemId: item.id })
}

const text = (value: unknown) => (typeof value === 'string' && value ? value : null)

/**
 * The course page's own params (`fromTerm`) are kept. `organize` is written as a boolean: the
 * router writes a string that reads as JSON in quotes (`?organize=%22true%22`).
 */
function moved(prev: Record<string, string | undefined>, next: Partial<Place>) {
  const search: Record<string, string | boolean | undefined> = { ...prev }
  for (const [key, value] of Object.entries(next)) {
    if (value) search[key] = value
    else delete search[key]
  }
  if (search.organize) search.organize = true
  // The route reads it back as text (`pageSearch`).
  return search as Record<string, string>
}

export type FilesLocation = Place & {
  /**
   * Goes somewhere: a new history entry, or `replace` for a change that is not a step of its own
   * (correcting a place that is gone, closing what a link opened).
   */
  go: (next: Partial<Place>, opts?: { replace?: boolean }) => void
  /** Returns to the previous history entry. */
  back: () => void
}

export function useFilesLocation(): FilesLocation {
  const search = useSearch({ strict: false }) as Record<string, unknown>
  const navigate = useNavigate()
  const router = useRouter()
  return {
    course: text(search.course),
    folder: text(search.folder),
    file: text(search.file),
    organize: search.organize === 'true',
    go: (next, opts) =>
      void navigate({
        to: '.',
        search: (prev: Record<string, string | undefined>) => moved(prev, next),
        replace: opts?.replace,
      }),
    back: () => router.history.back(),
  }
}

const samePreview = (a: PreviewTarget | null, b: PreviewTarget | null) =>
  a?.itemId === b?.itemId && a?.page === b?.page && a?.terms === b?.terms

/**
 * The preview of the file in the URL, shaped like `useDialogTarget` for `PreviewDialog`. A search
 * hit's page and words are not part of the address: they stay with the file they were opened for.
 * The file is kept while the dialog fades out after it has left the URL. Closing what this page
 * opened goes back the step opening it added, so back then leaves the page rather than reopening
 * the file; a preview that came with the address (a link, a reload) closes in place.
 */
export function usePreviewLocation(location: FilesLocation) {
  const [opened, setOpened] = useState<PreviewTarget | null>(null)
  const [shown, setShown] = useState<PreviewTarget | null>(null)
  // The file whose preview this page added a history entry for.
  const [pushed, setPushed] = useState<string | null>(null)
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
      setPushed(next.itemId)
      location.go({ file: next.itemId })
    },
    props: {
      open: linked !== null,
      onOpenChange: (open: boolean) => {
        if (open || !location.file) return
        if (pushed === location.file) location.back()
        else location.go({ file: null }, { replace: true })
        setPushed(null)
      },
      onOpenChangeComplete: (open: boolean) => {
        if (!open) setShown(null)
      },
    },
  }
}
