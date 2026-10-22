import { lmsFileSaveToCourse } from '@semestra/api-client'
import { lmsFileGetOptions, lmsFilePreviewOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { Download, Eye, FileQuestion, FolderInput } from 'lucide-react'
import { type ComponentProps, type ReactNode, useState } from 'react'
import { toast } from 'sonner'
import { errorCode, toastError } from '@/lib/errors'
import { formatBytes } from '@/lib/format'
import { Markdown } from '@/modules/files/components/Markdown'
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
/** Read on the server (M07's parser) and shown as text: Office files, CSV, Markdown. */
const AS_TEXT = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/markdown',
])
const AS_TEXT_NAME = /\.(docx|pptx|xlsx|csv|md)$/i

function previewKind(file: { name: string; mime_type?: string | null }) {
  const mime = file.mime_type ?? ''
  if (IMAGE.test(mime)) return 'image'
  if (FRAME.has(mime)) return 'frame'
  if (AS_TEXT.has(mime) || AS_TEXT_NAME.test(file.name)) return 'text'
  return null
}

/** The text of an Office file, page by page (slides, sheets), read by the server. */
function TextPreview({ fileId }: { fileId: string }) {
  const { courseId, query } = useCanvasPage()
  const preview = useQuery(
    lmsFilePreviewOptions({ path: { course_id: courseId, file_id: fileId }, query }),
  )
  return (
    <CanvasBoundary query={preview}>
      {(p) => {
        const label =
          p.kind === 'pptx'
            ? m.canvas_tab_preview_slide
            : p.kind === 'xlsx'
              ? m.canvas_tab_preview_sheet
              : m.canvas_tab_preview_page
        return (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">{m.canvas_tab_preview_text_only()}</p>
            {p.pages.map((page, i) => (
              // Pages have no id; their order never changes.
              // oxlint-disable-next-line react/no-array-index-key
              <section key={i} className="space-y-2 rounded-lg border p-4">
                {p.pages.length > 1 ? (
                  <h3 className="text-xs font-medium text-muted-foreground">
                    {label({ number: i + 1 })}
                  </h3>
                ) : null}
                <Markdown>{page}</Markdown>
              </section>
            ))}
            {p.truncated ? (
              <p className="text-xs text-muted-foreground">
                {m.canvas_tab_preview_truncated({ count: p.pages.length })}
              </p>
            ) : null}
          </div>
        )
      }}
    </CanvasBoundary>
  )
}

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
          {(file) => {
            const kind = previewKind(file)
            if (kind === 'image') {
              return (
                <img
                  src={src}
                  alt={file.name}
                  className="mx-auto max-h-[65vh] max-w-full object-contain"
                />
              )
            }
            if (kind === 'frame') {
              return (
                // The API serves it with `Content-Security-Policy: default-src 'none'`; a sandbox
                // would stop the browser's PDF viewer.
                // oxlint-disable-next-line react/iframe-missing-sandbox
                <iframe src={src} title={file.name} className="h-[65vh] w-full rounded-lg border" />
              )
            }
            if (kind === 'text') return <TextPreview fileId={fileId} />
            return (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <FileQuestion aria-hidden />
                  </EmptyMedia>
                  <EmptyTitle>{m.canvas_tab_file_no_preview()}</EmptyTitle>
                </EmptyHeader>
              </Empty>
            )
          }}
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
