import { lmsFileSaveToCourse } from '@semestra/api-client'
import { lmsFileGetOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { Download, Eye, FileQuestion, FolderInput } from 'lucide-react'
import { type ComponentProps, type ReactNode, useState } from 'react'
import { toast } from 'sonner'
import { errorCode, toastError } from '@/lib/errors'
import { formatBytes } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { CanvasBoundary } from '../CanvasBoundary'
import { useCanvasPage } from '../context'
import { fileContentUrl } from '../open-in-canvas'

/** What the browser shows inline; the backend streams anything else as a download (M09). */
const IMAGE = /^image\/(png|jpeg|gif|webp)$/
const FRAME = new Set(['application/pdf', 'text/plain'])

/** "Save to course files": the file is copied into the course's files (M07) and processed there. */
function useSaveToCourse(fileId: string, name: string) {
  const { courseId } = useCanvasPage()
  const [saving, setSaving] = useState(false)
  const save = () => {
    setSaving(true)
    lmsFileSaveToCourse({
      path: { course_id: courseId, file_id: fileId },
      body: {},
      throwOnError: true,
    })
      .then(
        ({ data }) => toast.success(m.canvas_tab_file_saved({ name: data.name || name })),
        (error: unknown) => {
          if (errorCode(error) === 'lms.feature_unsupported') {
            toast.error(m.canvas_tab_file_save_unavailable())
          } else toastError(error)
        },
      )
      .then(
        () => setSaving(false),
        () => setSaving(false),
      )
  }
  return { saving, save }
}

function IconAction({
  label,
  children,
  ...props
}: { label: string; children: ReactNode } & ComponentProps<typeof Button>) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label={label} {...props} />}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** Preview, download and save buttons of a file in a module. */
export function FileActions({ fileId, name }: { fileId: string; name: string }) {
  const { courseId, openFile } = useCanvasPage()
  const { saving, save } = useSaveToCourse(fileId, name)
  return (
    <div className="flex shrink-0 items-center">
      <IconAction label={m.canvas_tab_file_preview({ name })} onClick={() => openFile(fileId)}>
        <Eye aria-hidden />
      </IconAction>
      <IconAction
        label={m.canvas_tab_file_download({ name })}
        nativeButton={false}
        // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- labelled by `label`
        render={<a href={fileContentUrl(courseId, fileId, true)} download={name} />}
      >
        <Download aria-hidden />
      </IconAction>
      <IconAction label={m.canvas_tab_file_save({ name })} disabled={saving} onClick={save}>
        <FolderInput aria-hidden />
      </IconAction>
    </div>
  )
}

/** The preview of a Canvas file opened from a module or a link in a page. */
export function FilePreviewDialog({
  fileId,
  onClose,
}: {
  fileId: string | null
  onClose: () => void
}) {
  return (
    <Dialog open={fileId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-4xl">
        {fileId ? <PreviewBody fileId={fileId} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function PreviewBody({ fileId }: { fileId: string }) {
  const { courseId, query } = useCanvasPage()
  const meta = useQuery(
    lmsFileGetOptions({ path: { course_id: courseId, file_id: fileId }, query }),
  )
  const name = meta.data?.name ?? ''
  const { saving, save } = useSaveToCourse(fileId, name)
  const mime = meta.data?.mime_type ?? ''
  const src = fileContentUrl(courseId, fileId)
  const size = meta.data?.size_bytes
  const details = [mime, size == null ? '' : formatBytes(size)].filter(Boolean).join(' · ')
  return (
    <>
      <DialogHeader>
        <DialogTitle className="truncate pr-8">{name || m.common_loading()}</DialogTitle>
        <DialogDescription>{details || ' '}</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 flex-1 overflow-auto">
        <CanvasBoundary query={meta}>
          {(file) =>
            IMAGE.test(file.mime_type ?? '') ? (
              <img
                src={src}
                alt={file.name}
                className="mx-auto max-h-[65vh] max-w-full object-contain"
              />
            ) : FRAME.has(file.mime_type ?? '') ? (
              // The API serves it with `Content-Security-Policy: default-src 'none'`; a sandbox would
              // stop the browser's PDF viewer.
              // oxlint-disable-next-line react/iframe-missing-sandbox
              <iframe src={src} title={file.name} className="h-[65vh] w-full rounded-lg border" />
            ) : (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <FileQuestion aria-hidden />
                  </EmptyMedia>
                  <EmptyTitle>{m.canvas_tab_file_no_preview()}</EmptyTitle>
                </EmptyHeader>
              </Empty>
            )
          }
        </CanvasBoundary>
      </div>
      <DialogFooter>
        <Button variant="outline" disabled={!meta.data || saving} onClick={save}>
          <FolderInput aria-hidden />
          {m.canvas_tab_file_save_short()}
        </Button>
        <Button
          nativeButton={false}
          // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- the Button's children label it
          render={<a href={fileContentUrl(courseId, fileId, true)} download={name || undefined} />}
        >
          <Download aria-hidden />
          {m.canvas_tab_file_download_short()}
        </Button>
      </DialogFooter>
    </>
  )
}
