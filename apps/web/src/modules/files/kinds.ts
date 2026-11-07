import type { ItemOut } from '@semestra/api-client'
import {
  File,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType,
  Link2,
  type LucideIcon,
  Presentation,
} from 'lucide-react'
import { m } from '@/paraglide/messages'

/**
 * How a file is shown: `pdf` in the PDF viewer, `image` as is, `text`/`markdown` fetched and
 * rendered, `document` (Word, PowerPoint, Excel, HTML…) as the text the pipeline extracted, and
 * `none` as a download.
 */
export type PreviewKind = 'pdf' | 'image' | 'text' | 'markdown' | 'document' | 'none'

type Item = Pick<ItemOut, 'kind' | 'mime_type' | 'doc_status'>

const IMAGE = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

export function previewKind(item: Item): PreviewKind {
  if (item.kind === 'link') return 'none'
  const mime = item.mime_type ?? ''
  if (mime === 'application/pdf') return 'pdf'
  if (IMAGE.has(mime)) return 'image'
  if (mime === 'text/markdown') return 'markdown'
  if (mime === 'text/plain' || mime === 'text/csv') return 'text'
  return item.doc_status === 'ready' ? 'document' : 'none'
}

export function fileIcon(item: Pick<ItemOut, 'kind' | 'mime_type'>): LucideIcon {
  if (item.kind === 'link') return Link2
  const mime = item.mime_type ?? ''
  if (mime === 'application/pdf') return FileType
  if (mime.startsWith('image/')) return FileImage
  if (mime.includes('spreadsheet') || mime === 'text/csv') return FileSpreadsheet
  if (mime.includes('presentation')) return Presentation
  if (mime.includes('zip') || mime.includes('compressed')) return FileArchive
  if (mime.startsWith('text/') || mime.includes('wordprocessing')) return FileText
  return File
}

/** "pdf", "docx", "link"… for the type column and grid tiles. */
export function typeLabel(item: Pick<ItemOut, 'kind' | 'display_name' | 'original_name'>) {
  if (item.kind === 'link') return 'link'
  const name = item.original_name ?? item.display_name
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/** The kind of a file as people name it ("Word document"), from its type or extension. */
export function fileKindName(file: { name: string; mime_type?: string | null }): string | null {
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
