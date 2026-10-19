import { Link2, Megaphone, School } from 'lucide-react'
import { lazy } from 'react'
import { defineModule } from '@/app/extensions'
import { COURSE_INFO_ROWS, TERM_WIZARD_IMPORT_SOURCES } from '@/modules/academics/types'
import { ASSESSMENT_IMPORT_SOURCES, COURSE_GRADES_BANNERS } from '@/modules/grading/types'
import { m } from '@/paraglide/messages'
import { CourseInfoLms } from './components/CourseInfoLms'
import { LmsUpdatesBanner } from './components/LmsUpdatesBanner'
import { assignmentSource, termCourseCommand, wizardCourseSource } from './import/sources'
import { canvasUi } from './providers/canvas'
import { LMS_QUERIES } from './queries'
import { LMS_PROVIDER_UI } from './types'

const EVENTS = [
  'lms.connection.created',
  'lms.connection.updated',
  'lms.connection.deleted',
  'lms.connection.status_changed',
  'lms.program.bound',
  'lms.course.linked',
  'lms.course.unlinked',
  'lms.course.link_updated',
] as const

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
      component: lazy(() => sections().then((s) => ({ default: s.ConnectionsSection }))),
    },
    {
      id: 'program-lms',
      level: 'program',
      group: 'integrations',
      title: m.lms_settings_program,
      description: m.lms_settings_program_description,
      icon: Link2,
      order: 10,
      component: lazy(() => sections().then((s) => ({ default: s.ProgramLmsSection }))),
    },
    {
      id: 'course-lms',
      level: 'course',
      group: 'integrations',
      title: m.lms_settings_course,
      description: m.lms_settings_course_description,
      icon: Link2,
      order: 10,
      component: lazy(() => sections().then((s) => ({ default: s.CourseLmsSection }))),
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
      component: lazy(() => import('./cards/AnnouncementsCard')),
      multiple: false,
    },
  ],
  commands: [termCourseCommand],
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
  realtimeInvalidations: Object.fromEntries(EVENTS.map((event) => [event, LMS_QUERIES])),
})
