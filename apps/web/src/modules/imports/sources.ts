import type { ItemOut } from '@semestra/api-client'
import { CalendarDays, ClipboardPaste, FileText, Image, type LucideIcon } from 'lucide-react'
import type { AiPurpose } from '@/hooks/use-ai-status'
import { m } from '@/paraglide/messages'
import type { ImportSourceKind } from './types'

/** What each import source asks the user for (M08 §4). AI sources need a model for `purpose`. */
export type SourceSpec = {
  title: () => string
  hint: () => string
  icon: LucideIcon
  /** The file types, as react-dropzone takes them (MIME type → extensions); undefined = pasted text. */
  accept?: Record<string, string[]>
  multiple?: boolean
  purpose?: AiPurpose
}

const IMAGES = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
}

export const SOURCES: Record<ImportSourceKind, SourceSpec> = {
  ics: {
    title: m.imports_source_ics,
    hint: m.imports_source_ics_hint,
    icon: CalendarDays,
    accept: { 'text/calendar': ['.ics'] },
  },
  syllabus: {
    title: m.imports_source_syllabus,
    hint: m.imports_source_syllabus_hint,
    icon: FileText,
    accept: {
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
      'text/plain': ['.txt'],
      'text/markdown': ['.md'],
      ...IMAGES,
    },
    multiple: true,
    purpose: 'extraction',
  },
  timetable_image: {
    title: m.imports_source_timetable,
    hint: m.imports_source_timetable_hint,
    icon: Image,
    accept: { ...IMAGES, 'application/pdf': ['.pdf'] },
    purpose: 'vision',
  },
  text: {
    title: m.imports_source_text,
    hint: m.imports_source_text_hint,
    icon: ClipboardPaste,
    purpose: 'extraction',
  },
}

/**
 * Course files a syllabus import can read: files M07 parses (or is about to). The import waits
 * for one still being processed.
 */
export function readableCourseFile(item: ItemOut): boolean {
  return item.kind === 'file' && item.doc_status !== 'unsupported' && item.doc_status !== 'failed'
}
