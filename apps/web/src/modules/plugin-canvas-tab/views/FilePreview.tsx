import { type FileMeta, lmsFileContent, lmsFileSaveToCourse } from '@semestra/api-client'
import { lmsFileGetOptions, lmsFilePreviewOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { Download, Eye, FileQuestion, FolderInput } from 'lucide-react'
import { type ReactNode, Suspense, useState } from 'react'
import { toast } from 'sonner'
import type { DialogTargetProps } from '@/lib/dialog-target'
import { errorCode, toastError } from '@/lib/errors'
import { formatBytes } from '@/lib/format'
import { LazyPdfViewer } from '@/modules/files/components/LazyPdfViewer'
import { Markdown } from '@/modules/files/components/Markdown'
import { m } from '@/paraglide/messages'
import { PreviewShell } from '@/modules/files/components/PreviewShell'
import { Button } from '@/ui/button'
import { fileKindName } from '@/modules/files/kinds'
import { Spinner } from '@/ui/spinner'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { Skeleton } from '@/ui/skeleton'
import { CanvasBoundary } from '../CanvasBoundary'
import { useCanvasPage } from '../context'
import { fileContentUrl } from '../open-in-canvas'
import { IconAction, LockNote } from './common'

/** What the browser shows inline; the backend streams anything else as a download (M09). */
const IMAGE = /^image\/(png|jpeg|gif|webp)$/
const FRAME = new Set(['text/plain'])
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
  if (mime === 'application/pdf') return 'pdf'
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
    <CanvasBoundary query={check} skeleton={<Skeleton className="size-full min-h-64 rounded-lg" />}>
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

/** The preview of a Canvas file opened from a module or a link in a page; the same frame as the
 * course files preview (M07 §6.1), with "Save to course files" among the actions. */
export function FilePreviewDialog({
  fileId: shown,
  ...props
}: { fileId: string | null } & DialogTargetProps) {
  const { courseId } = useCanvasPage()
  const meta = useQuery({
    ...lmsFileGetOptions({ path: { course_id: courseId, file_id: shown ?? '' } }),
    enabled: shown !== null,
  })
  const name = meta.data?.name ?? ''
  const { saving, save } = useSaveToCourse(shown ?? '', name)
  const size = meta.data?.size_bytes
  const details = [
    meta.data ? fileKindName(meta.data) : null,
    size == null ? null : formatBytes(size),
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <PreviewShell
      {...props}
      title={name || m.common_loading()}
      meta={details}
      footer={
        shown ? (
          <>
            <Button variant="outline" disabled={!meta.data || saving} onClick={save}>
              <FolderInput aria-hidden />
              {m.canvas_tab_file_save_short()}
            </Button>
            <Button
              nativeButton={false}
              render={
                // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- the children label it
                <a href={fileContentUrl(courseId, shown, true)} download={name || undefined} />
              }
            >
              <Download aria-hidden />
              {m.canvas_tab_file_download_short()}
            </Button>
          </>
        ) : null
      }
    >
      {shown ? (
        <CanvasBoundary query={meta}>{(file) => <PreviewBody file={file} />}</CanvasBoundary>
      ) : null}
    </PreviewShell>
  )
}

function PreviewBody({ file }: { file: FileMeta }) {
  const { courseId } = useCanvasPage()
  const src = fileContentUrl(courseId, file.external_id)
  const kind = previewKind(file)
  if (kind === 'pdf') {
    return (
      <ContentCheck file={file}>
        <Suspense
          fallback={
            <div className="flex h-64 items-center justify-center">
              <Spinner />
            </div>
          }
        >
          <LazyPdfViewer url={src} />
        </Suspense>
      </ContentCheck>
    )
  }
  if (kind === 'image') {
    return (
      <ContentCheck file={file}>
        <div className="flex justify-center">
          <img src={src} alt={file.name} className="max-h-full max-w-full" />
        </div>
      </ContentCheck>
    )
  }
  if (kind === 'frame') {
    return (
      <ContentCheck file={file}>
        {/* The API serves it with `Content-Security-Policy: default-src 'none'`. */}
        {/* oxlint-disable-next-line react/iframe-missing-sandbox */}
        <iframe src={src} title={file.name} className="size-full rounded-lg border" />
      </ContentCheck>
    )
  }
  if (kind === 'text') return <TextPreview fileId={file.external_id} />
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
}
