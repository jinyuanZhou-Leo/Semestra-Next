import { History, Import } from 'lucide-react'
import { defineModule, preloadable } from '@/app/extensions'
import { COURSE_INFO_ACTIONS, TERM_WIZARD_IMPORT_SOURCES } from '@/modules/academics/types'
import { FILE_ITEM_ACTIONS } from '@/modules/files/types'
import { ASSESSMENT_IMPORT_SOURCES } from '@/modules/grading/types'
import { MEETING_IMPORT_SOURCES } from '@/modules/schedule/types'
import { m } from '@/paraglide/messages'
import { ImportHost } from './components/ImportHost'
import {
  courseInfoFromSyllabus,
  meetingSource,
  readCourseFile,
  syllabusGradingSource,
  wizardSource,
} from './entries'

const SESSION_EVENTS = [
  'imports.session.ready',
  'imports.session.failed',
  'imports.session.committed',
] as const

/**
 * M08 导入中心: import sessions from ICS files, syllabi, timetable screenshots and pasted text,
 * reviewed in one dialog before anything is written. Contributes import sources to the term
 * wizard, the gradebook and the course schedule, "Update from syllabus" to the course info card
 * and "Read with AI…" to course files; the dialog itself is an overlay that `openImport()` opens.
 */
export default defineModule({
  id: 'imports',
  kind: 'core',
  name: m.imports_name,
  description: m.imports_description,
  icon: Import,
  overlays: [ImportHost],
  settingsSections: [
    {
      id: 'import-history',
      level: 'program',
      group: 'data',
      title: m.imports_history,
      description: m.imports_history_description,
      icon: History,
      order: 20,
      component: preloadable(() =>
        import('./settings/ImportHistorySection').then((s) => ({
          default: s.ImportHistorySection,
        })),
      ),
    },
  ],
  jobKinds: [
    {
      kind: 'imports.extract',
      title: m.imports_job_title,
      to: (job) => {
        const result = job.result as { session_id?: string; program_id?: string } | null
        return result?.session_id && result.program_id
          ? `/p/${result.program_id}/imports/${result.session_id}`
          : undefined
      },
    },
  ],
  extensions: {
    [TERM_WIZARD_IMPORT_SOURCES]: [
      wizardSource('ics'),
      wizardSource('syllabus'),
      wizardSource('timetable_image'),
      wizardSource('text'),
    ],
    [ASSESSMENT_IMPORT_SOURCES]: [syllabusGradingSource],
    [MEETING_IMPORT_SOURCES]: [meetingSource('ics'), meetingSource('timetable_image')],
    [COURSE_INFO_ACTIONS]: [courseInfoFromSyllabus],
    [FILE_ITEM_ACTIONS]: [readCourseFile],
  },
  realtimeInvalidations: Object.fromEntries(
    SESSION_EVENTS.map((event) => [event, ['importsSessionGet', 'importsSessionList']]),
  ),
})
