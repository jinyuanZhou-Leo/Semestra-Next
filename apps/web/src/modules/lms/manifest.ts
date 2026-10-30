import { Link2, Megaphone, PencilLine, School } from 'lucide-react'
import { defineModule, preloadable } from '@/app/extensions'
import { COURSE_INFO_ROWS, TERM_WIZARD_IMPORT_SOURCES } from '@/modules/academics/types'
import { ASSESSMENT_IMPORT_SOURCES, COURSE_GRADES_BANNERS } from '@/modules/grading/types'
import { m } from '@/paraglide/messages'
import { CourseInfoLms } from './components/CourseInfoLms'
import { LmsUpdatesBanner } from './components/LmsUpdatesBanner'
import { assignmentSource, wizardCourseSource } from './import/sources'
import { canvasUi } from './providers/canvas'
import { LMS_QUERIES, LMS_STATE_QUERIES } from './queries'
import { LMS_PROVIDER_UI } from './types'

// A connection's change can change what every course reads; the rest only the LMS state.
const CONNECTION_EVENTS = [
  'lms.connection.created',
  'lms.connection.updated',
  'lms.connection.deleted',
  'lms.connection.status_changed',
] as const
const STATE_EVENTS = ['lms.program.bound', 'lms.course.link_updated'] as const
// Linking or unlinking also changes which courses the term announcements card reads.
const LINK_EVENTS = ['lms.course.linked', 'lms.course.unlinked'] as const

const sections = () => import('./settings/sections')

/**
 * M09 LMS 集成: connections to learning platforms (Canvas for now), a Program's binding, course
 * links, imports through the M08 review and the platform's calendar. Platform-specific UI comes
 * from `lms.providerUi`; the Canvas tab itself is M16.
 */
export default defineModule({
  id: 'lms',
  kind: 'core',
  name: m.lms_name,
  description: m.lms_description,
  icon: School,
  settingsSections: [
    {
      id: 'lms-connections',
      level: 'account',
      group: 'integrations',
      title: m.lms_settings_connections,
      description: m.lms_settings_connections_description,
      icon: Link2,
      order: 10,
      component: preloadable(() => sections().then((s) => ({ default: s.ConnectionsSection }))),
    },
    {
      id: 'lms-writes',
      level: 'account',
      group: 'integrations',
      title: m.lms_settings_writes,
      description: m.lms_settings_writes_description,
      icon: PencilLine,
      order: 20,
      namespace: 'lms',
    },
    {
      id: 'program-lms',
      level: 'program',
      group: 'integrations',
      title: m.lms_settings_program,
      description: m.lms_settings_program_description,
      icon: Link2,
      order: 10,
      component: preloadable(() => sections().then((s) => ({ default: s.ProgramLmsSection }))),
    },
    {
      id: 'course-lms',
      level: 'course',
      group: 'integrations',
      title: m.lms_settings_course,
      description: m.lms_settings_course_description,
      icon: Link2,
      order: 10,
      component: preloadable(() => sections().then((s) => ({ default: s.CourseLmsSection }))),
    },
  ],
  cards: [
    {
      id: 'lms.announcements',
      scopes: ['course', 'term'],
      title: m.lms_card_announcements,
      icon: Megaphone,
      sizes: ['m', 'l'],
      defaultSize: 'm',
      component: preloadable(() => import('./cards/AnnouncementsCard')),
      multiple: false,
    },
  ],
  calendarSources: [
    {
      source: 'lms.events',
      label: m.lms_calendar_source,
      icon: School,
      defaultVisible: true,
      onOpen: (occurrence) => {
        const url = occurrence.meta?.url
        // Platform data: only web links are opened (the API drops the rest too).
        if (url && /^https?:\/\//i.test(url)) window.open(url, '_blank', 'noopener,noreferrer')
      },
    },
  ],
  extensions: {
    [LMS_PROVIDER_UI]: [canvasUi],
    [TERM_WIZARD_IMPORT_SOURCES]: [wizardCourseSource],
    [ASSESSMENT_IMPORT_SOURCES]: [assignmentSource],
    [COURSE_INFO_ROWS]: [{ id: 'lms.link', order: 100, component: CourseInfoLms }],
    [COURSE_GRADES_BANNERS]: [{ id: 'lms.updates', component: LmsUpdatesBanner }],
  },
  realtimeInvalidations: {
    ...Object.fromEntries(CONNECTION_EVENTS.map((event) => [event, LMS_QUERIES])),
    ...Object.fromEntries(STATE_EVENTS.map((event) => [event, LMS_STATE_QUERIES])),
    ...Object.fromEntries(
      LINK_EVENTS.map((event) => [event, [...LMS_STATE_QUERIES, 'lmsTermAnnouncementList']]),
    ),
  },
})
