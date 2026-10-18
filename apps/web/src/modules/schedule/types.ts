import type { LucideIcon } from 'lucide-react'
import type { Message } from '@/app/extensions'

/**
 * Extension point `schedule.meetingImportSources` (M04 §5.3): ways to add meetings to a course
 * from elsewhere, listed in the course's schedule page. M08 contributes ICS and screenshots.
 * `launch` runs the import (its own dialog or review screen) and resolves when it is done.
 */
export type MeetingImportSource = {
  id: string
  title: Message
  icon: LucideIcon
  description?: Message
  launch: (ctx: { programId: string; courseId: string; termId: string }) => Promise<void>
}

export const MEETING_IMPORT_SOURCES = 'schedule.meetingImportSources'
