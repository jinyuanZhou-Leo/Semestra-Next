import type { ItemOut, UploadResult } from '@semestra/api-client'
import { useQueryClient } from '@tanstack/react-query'
import { CircleAlert, CircleCheck, X } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { toast } from 'sonner'
import { postWithProgress } from '@/app/api'
import { errorMessage } from '@/lib/errors'
import { formatBytes } from '@/lib/format'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/ui/alert-dialog'
import { Button } from '@/ui/button'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/ui/item'
import { Progress } from '@/ui/progress'
import { Spinner } from '@/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { invalidateFiles, useFilesUsage } from '../queries'
import { findDuplicates, planUpload, sha256Hex } from '../upload'

type Row = {
  key: string
  name: string
  size: number
  status: 'queued' | 'uploading' | 'done' | 'failed'
  // Bytes sent so far, for the panel's progress bar.
  loaded: number
  error?: string
}

/** Where an upload goes: a course folder (null for the top), and what that course has already. */
export type UploadTarget = {
  courseId: string
  folderId: string | null
  existing: readonly ItemOut[]
}

/**
 * Uploading into course folders (M07 §6.1): the quota and size checks, the "already exists"
 * question, then one file per request so each row shows its own state. Render `panel` and
 * `dialog` once; call `start(files, target)` from the button or a drop zone.
 */
export function useUploads(): {
  start: (files: readonly File[], target: UploadTarget) => void
  panel: ReactNode
  dialog: ReactNode
} {
  const queryClient = useQueryClient()
  const usage = useFilesUsage().data
  const [rows, setRows] = useState<Row[]>([])
  const [duplicates, setDuplicates] = useState<{
    all: File[]
    dupes: File[]
    target: UploadTarget
  } | null>(null)

  const patch = (key: string, change: Partial<Row>) =>
    setRows((current) => current.map((r) => (r.key === key ? { ...r, ...change } : r)))

  const send = async (files: readonly File[], { courseId, folderId }: UploadTarget) => {
    const queued = files.map((file) => ({
      file,
      row: {
        // crypto.randomUUID needs a secure context, which a LAN address over http is not.
        key: `${Date.now()}-${Math.random()}`,
        name: file.name,
        size: file.size,
        status: 'queued' as const,
        loaded: 0,
      },
    }))
    setRows((current) => [
      ...current.filter((r) => r.status !== 'done'),
      ...queued.map((q) => q.row),
    ])
    for (const { file, row } of queued) {
      patch(row.key, { status: 'uploading' })
      const form = new FormData()
      form.append('files', file)
      if (folderId) form.append('folder_id', folderId)
      await postWithProgress<UploadResult>(`/courses/${courseId}/files`, form, {
        onProgress: (loaded) => patch(row.key, { loaded }),
      })
        .then(() => patch(row.key, { status: 'done', loaded: row.size }))
        .catch((error: unknown) =>
          patch(row.key, { status: 'failed', loaded: row.size, error: errorMessage(error) }),
        )
    }
    await invalidateFiles(queryClient)
  }

  const start = (files: readonly File[], target: UploadTarget) => {
    if (files.length === 0) return
    const plan = planUpload(files, usage)
    for (const file of plan.tooLarge) {
      toast.error(
        m.files_upload_too_large({
          name: file.name,
          max: formatBytes(usage?.max_upload_bytes ?? 0),
        }),
      )
    }
    if (!plan.room) {
      toast.error(m.files_upload_no_room({ remaining: formatBytes(plan.remaining ?? 0) }))
      return
    }
    if (plan.accepted.length === 0) return
    void Promise.all(plan.accepted.map(async (file) => ({ file, sha256: await sha256Hex(file) })))
      .then((hashed) => {
        const dupes = findDuplicates(hashed, target.existing, target.folderId)
        if (dupes.size === 0) return send(plan.accepted, target)
        setDuplicates({
          all: plan.accepted,
          dupes: plan.accepted.filter((f) => dupes.has(f)),
          target,
        })
      })
      .catch(() => send(plan.accepted, target))
  }

  const active = rows.some((r) => r.status === 'queued' || r.status === 'uploading')
  const finished = rows.filter((r) => r.status === 'done' || r.status === 'failed').length
  const totalBytes = rows.reduce((sum, r) => sum + r.size, 0)
  const sentBytes = rows.reduce((sum, r) => sum + Math.min(r.loaded, r.size), 0)

  const panel =
    rows.length > 0 ? (
      <section
        aria-label={m.files_uploads()}
        className="fixed right-4 bottom-4 z-40 w-80 rounded-2xl border bg-popover p-3 text-popover-foreground shadow-lg"
      >
        <div className="mb-2 flex h-7 items-center justify-between gap-2">
          <h2 className="text-sm font-medium">
            {active
              ? m.files_uploading_count({ done: finished, total: rows.length })
              : m.files_uploads_finished()}
          </h2>
          {active ? null : (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={m.common_close()}
                    onClick={() => setRows([])}
                  />
                }
              >
                <X aria-hidden />
              </TooltipTrigger>
              <TooltipContent>{m.common_close()}</TooltipContent>
            </Tooltip>
          )}
        </div>
        <Progress
          value={totalBytes > 0 ? (sentBytes / totalBytes) * 100 : (finished / rows.length) * 100}
          aria-label={m.files_uploads()}
          className="mb-2 [&_[data-slot=progress-track]]:h-1"
        />
        <ItemGroup className="max-h-56 overflow-y-auto">
          {rows.map((row) => (
            <Item key={row.key} size="sm" className="px-1 py-1.5">
              <ItemContent className="min-w-0">
                <ItemTitle className="w-full truncate font-normal">{row.name}</ItemTitle>
                <ItemDescription className={cn('truncate', row.error && 'text-destructive')}>
                  {row.error ?? formatBytes(row.size)}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                {row.status === 'uploading' || row.status === 'queued' ? (
                  <Spinner className={cn(row.status === 'queued' && 'opacity-40')} />
                ) : row.status === 'done' ? (
                  <CircleCheck aria-label={m.files_upload_done()} className="size-4 text-success" />
                ) : (
                  <CircleAlert
                    aria-label={m.files_upload_failed()}
                    className="size-4 text-destructive"
                  />
                )}
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      </section>
    ) : null

  // Closing the question any way but "Upload anyway" skips the duplicates and keeps the rest.
  const skipDuplicates = () => {
    if (!duplicates) return
    const rest = duplicates.all.filter((f) => !duplicates.dupes.includes(f))
    setDuplicates(null)
    if (rest.length) void send(rest, duplicates.target)
  }
  const dialog = (
    <AlertDialog open={duplicates !== null} onOpenChange={(open) => !open && skipDuplicates()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{m.files_duplicate_title()}</AlertDialogTitle>
          <AlertDialogDescription>
            {m.files_duplicate_description({
              names: (duplicates?.dupes ?? []).map((f) => f.name).join(', '),
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{m.files_duplicate_skip()}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              if (!duplicates) return
              setDuplicates(null)
              void send(duplicates.all, duplicates.target)
            }}
          >
            {m.files_duplicate_upload_anyway()}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  return { start, panel, dialog }
}
