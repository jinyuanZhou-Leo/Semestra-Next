import { CalendarDays, ClipboardPaste, FileText, Image, type LucideIcon } from 'lucide-react'
import type { AiPurpose } from '@/hooks/use-ai-status'
import { m } from '@/paraglide/messages'
import type { ImportSourceKind } from './types'

/** What each import source asks the user for (M08 §4). AI sources need a model for `purpose`. */
export type SourceSpec = {
  title: () => string
  hint: () => string
  icon: LucideIcon
  /** `accept` of the file input; undefined = pasted text. */
  accept?: string
  multiple?: boolean
  purpose?: AiPurpose
}

export const SOURCES: Record<ImportSourceKind, SourceSpec> = {
  ics: {
    title: m.imports_source_ics,
    hint: m.imports_source_ics_hint,
    icon: CalendarDays,
    accept: '.ics,text/calendar',
  },
  syllabus: {
    title: m.imports_source_syllabus,
    hint: m.imports_source_syllabus_hint,
    icon: FileText,
    accept: '.pdf,.docx,.pptx,.txt,.md,.png,.jpg,.jpeg,.webp',
    multiple: true,
    purpose: 'extraction',
  },
  timetable_image: {
    title: m.imports_source_timetable,
    hint: m.imports_source_timetable_hint,
    icon: Image,
    accept: '.png,.jpg,.jpeg,.webp,.pdf',
    purpose: 'vision',
  },
  text: {
    title: m.imports_source_text,
    hint: m.imports_source_text_hint,
    icon: ClipboardPaste,
    purpose: 'extraction',
  },
}
