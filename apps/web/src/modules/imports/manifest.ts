import { importsSessionListOptions } from '@semestra/api-client/react-query'
import { History, Import } from 'lucide-react'
import { defineModule, preloadable } from '@/app/extensions'
import {
  COURSE_INFO_FILLS,
  type CourseInfoFill,
  TERM_WIZARD_IMPORT_SOURCES,
} from '@/modules/academics/types'
import { ASSESSMENT_IMPORT_SOURCES } from '@/modules/grading/types'
import { MEETING_IMPORT_SOURCES } from '@/modules/schedule/types'
import { m } from '@/paraglide/messages'
import { ImportHost } from './components/ImportHost'
import { meetingSource, syllabusGradingSource, wizardSource } from './entries'
import { useImportLine } from './status-line'

/** "Read from a file" above the course's basics in its settings. */
const courseInfoFill: CourseInfoFill = {
  id: 'imports.syllabus',
  component: preloadable(() =>
    import('./components/CourseInfoFill').then((c) => ({ default: c.CourseInfoFill })),
  ),
}

/** Every status a session moves to is announced (M08 §3): new ones too, and discarded ones. */
const SESSION_EVENTS = [
  'imports.session.extracting',
  'imports.session.waiting_files',
  'imports.session.ready',
  'imports.session.up_to_date',
  'imports.session.failed',
  'imports.session.committed',
  'imports.session.discarded',
] as const

/** The session that moved, and the lists of sessions. */
const ofSession = (data: Readonly<Record<string, unknown>>) => [
  { _id: 'importsSessionGet', path: { session_id: String(data.session_id) } },
  'importsSessionList',
]

/**
 * M08 导入中心: import sessions from ICS files, syllabi, timetable screenshots and pasted text,
 * reviewed in one dialog before anything is written. Contributes import sources to the term
 * wizard, the gradebook and the course schedule, and "Read from a file" to the course settings;
 * the dialog itself is an overlay that `openImport()` opens.
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
      group: 'files',
      title: m.imports_history,
      description: m.imports_history_description,
      icon: History,
      order: 20,
      component: preloadable(() =>
        import('./settings/ImportHistorySection').then((s) => ({
          default: s.ImportHistorySection,
        })),
      ),
      prefetch: (scope, queryClient) =>
        queryClient.ensureQueryData(
          importsSessionListOptions({ path: { program_id: scope?.programId ?? '' } }),
        ),
    },
  ],
  jobKinds: [{ kind: 'imports.extract', title: m.imports_job_title }],
  statusItems: [{ id: 'imports.unfinished', order: 30, useStatus: useImportLine }],
  extensions: {
    [TERM_WIZARD_IMPORT_SOURCES]: [
      wizardSource('ics'),
      wizardSource('syllabus'),
      wizardSource('timetable_image'),
      wizardSource('text'),
    ],
    [ASSESSMENT_IMPORT_SOURCES]: [syllabusGradingSource],
    [MEETING_IMPORT_SOURCES]: [meetingSource('ics'), meetingSource('timetable_image')],
    [COURSE_INFO_FILLS]: [courseInfoFill],
  },
  realtimeInvalidations: Object.fromEntries(SESSION_EVENTS.map((event) => [event, [ofSession]])),
})
