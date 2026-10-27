import { type FileMeta, lmsFileContent, lmsFileSaveToCourse } from '@semestra/api-client'
import { lmsFileGetOptions, lmsFilePreviewOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { Download, Eye, FileQuestion, FolderInput } from 'lucide-react'
import { type ReactNode, useState } from 'react'
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
import { Skeleton } from '@/ui/skeleton'
import { CanvasBoundary } from '../CanvasBoundary'
import { useCanvasPage } from '../context'
import { fileContentUrl } from '../open-in-canvas'
import { IconAction, LockNote } from './common'

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

/** The kind of a file as people name it ("Word document"), from its type or extension. */
export function fileKindLabel(file: { name: string; mime_type?: string | null }): string | null {
  const mime = file.mime_type ?? ''
  const ext = /\.([a-z0-9]{1,8})$/i.exec(file.name)?.[1]?.toLowerCase() ?? ''
  if (mime === 'application/pdf' || ext === 'pdf') return m.canvas_tab_file_kind_pdf()
  if (/wordprocessingml|msword/.test(mime) || ext === 'docx' || ext === 'doc')
    return m.canvas_tab_file_kind_word()
  if (/presentationml|powerpoint/.test(mime) || ext === 'pptx' || ext === 'ppt')
    return m.canvas_tab_file_kind_slides()
  if (/spreadsheetml|ms-excel/.test(mime) || ext === 'xlsx' || ext === 'xls')
    return m.canvas_tab_file_kind_sheet()
  if (mime.startsWith('image/')) return m.canvas_tab_file_kind_image()
  if (mime.startsWith('video/')) return m.canvas_tab_file_kind_video()
  if (mime.startsWith('audio/')) return m.canvas_tab_file_kind_audio()
  if (/zip|compressed|x-tar|gzip/.test(mime) || ['zip', 'gz', 'tar', '7z', 'rar'].includes(ext))
    return m.canvas_tab_file_kind_archive()
  if (mime === 'text/plain' || ext === 'txt') return m.canvas_tab_file_kind_text()
  return ext ? m.canvas_tab_file_kind_other({ ext: ext.toUpperCase() }) : null
}

function previewKind(file: { name: string; mime_type?: string | null }) {
  const mime = file.mime_type ?? ''
  if (IMAGE.test(mime)) return 'image'
  if (FRAME.has(mime)) return 'frame'
  if (AS_TEXT.has(mime) || AS_TEXT_NAME.test(file.name)) return 'text'
  return null
}

/** The text of an Office file, page by page (slides, sheets), read by the server. */
function TextPreview({ fileId }: { fileId: string }) {
  const { courseId } = useCanvasPage()
  const preview = useQuery(
    lmsFilePreviewOptions({ path: { course_id: courseId, file_id: fileId } }),
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

/**
 * An inline preview loads the file in an `<img>` or `<iframe>`, which can't tell a failed load:
 * the proxy is asked first whether the file opens (`check`, no content), so a locked file or an
 * unreachable Canvas shows the same message as the other reads instead of an error page.
 */
function ContentCheck({ file, children }: { file: FileMeta; children: ReactNode }) {
  const { courseId } = useCanvasPage()
  const check = useQuery({
    queryKey: ['canvas-tab', 'content-check', courseId, file.external_id],
    queryFn: async ({ signal }) => {
      await lmsFileContent({
        path: { course_id: courseId, file_id: file.external_id },
        query: { check: true },
        signal,
        throwOnError: true,
      })
      return true
    },
    enabled: !file.locked,
    retry: false,
    staleTime: 5 * 60_000,
  })
  if (file.locked) return <LockNote title={m.canvas_tab_item_locked()} />
  return (
    <CanvasBoundary query={check} skeleton={<Skeleton className="h-[65vh] w-full rounded-lg" />}>
      {() => children}
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

/** Preview, download and save buttons of a file in a module. */
export function FileActions({ fileId, name }: { fileId: string; name: string }) {
  const { courseId, openFile } = useCanvasPage()
  const { saving, save } = useSaveToCourse(fileId, name)
  return (
    <div className="flex shrink-0 items-center">
      <IconAction
        label={m.canvas_tab_file_preview({ name })}
        tooltip={m.canvas_tab_file_preview_short()}
        onClick={() => openFile(fileId)}
      >
        <Eye aria-hidden />
      </IconAction>
      <IconAction
        label={m.canvas_tab_file_download({ name })}
        tooltip={m.canvas_tab_file_download_short()}
        nativeButton={false}
        // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- labelled by `label`
        render={<a href={fileContentUrl(courseId, fileId, true)} download={name} />}
      >
        <Download aria-hidden />
      </IconAction>
      <IconAction
        label={m.canvas_tab_file_save({ name })}
        tooltip={m.canvas_tab_file_save_short()}
        disabled={saving}
        onClick={save}
      >
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
  const { courseId } = useCanvasPage()
  const meta = useQuery(lmsFileGetOptions({ path: { course_id: courseId, file_id: fileId } }))
  const name = meta.data?.name ?? ''
  const { saving, save } = useSaveToCourse(fileId, name)
  const src = fileContentUrl(courseId, fileId)
  const size = meta.data?.size_bytes
  const details = [
    meta.data ? fileKindLabel(meta.data) : null,
    size == null ? null : formatBytes(size),
  ]
    .filter(Boolean)
    .join(' · ')
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
                <ContentCheck file={file}>
                  <img
                    src={src}
                    alt={file.name}
                    className="mx-auto max-h-[65vh] max-w-full object-contain"
                  />
                </ContentCheck>
              )
            }
            if (kind === 'frame') {
              return (
                <ContentCheck file={file}>
                  {/* The API serves it with `Content-Security-Policy: default-src 'none'`; a
                      sandbox would stop the browser's PDF viewer. */}
                  {/* oxlint-disable-next-line react/iframe-missing-sandbox */}
                  <iframe
                    src={src}
                    title={file.name}
                    className="h-[65vh] w-full rounded-lg border"
                  />
                </ContentCheck>
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
