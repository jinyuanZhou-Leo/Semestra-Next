import { ExternalLink, Link2, Megaphone, RefreshCw, School } from 'lucide-react'
import { defineModule, preloadable } from '@/app/extensions'
import type { LmsProgramBindingGetResponse, LmsProviderListResponse } from '@semestra/api-client'
import {
  lmsProgramBindingGetOptions,
  lmsProviderListOptions,
} from '@semestra/api-client/react-query'
import {
  COURSE_INFO_ROWS,
  ONBOARDING_STEPS,
  type OnboardingStep,
  TERM_WIZARD_IMPORT_SOURCES,
} from '@/modules/academics/types'
import {
  ASSESSMENT_ACTIONS,
  ASSESSMENT_IMPORT_SOURCES,
  COURSE_GRADES_BANNERS,
} from '@/modules/grading/types'
import { TASK_DETAIL_SECTIONS, type TaskDetailSection } from '@/modules/tasks/types'
import { m } from '@/paraglide/messages'
import { bindAction, unbindAction } from './binding/actions'
import { CalendarMark, CalendarOpenLabel } from './components/CalendarMark'
import { CourseInfoLms } from './components/CourseInfoLms'
import { NewAssignmentsToast } from './components/NewAssignmentsToast'
import { LmsUpdatesBanner } from './components/LmsUpdatesBanner'
import TaskSubmission from './components/TaskSubmission'
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

const onboardingSteps: readonly OnboardingStep[] = [
  {
    id: 'lms.connect',
    // After AI, before the first term (whose wizard imports the platform's courses).
    order: 200,
    icon: School,
    title: m.lms_onboarding_title,
    description: m.lms_onboarding_body,
    component: preloadable(() => import('./onboarding/ConnectLmsStep')),
    summary: preloadable(() => import('./onboarding/LmsSummary')),
    status: {
      queries: (programId) => [
        lmsProviderListOptions(),
        ...(programId ? [lmsProgramBindingGetOptions({ path: { program_id: programId } })] : []),
      ],
      read: ([providers, binding]) => ({
        offered: (providers as LmsProviderListResponse).items.length > 0,
        provides: (binding as LmsProgramBindingGetResponse | undefined)?.connection_id
          ? ['lms']
          : [],
      }),
    },
  },
]

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
  overlays: [NewAssignmentsToast],
  settingsSections: [
    {
      id: 'lms-connections',
      level: 'account',
      group: 'lms',
      title: m.lms_settings_connections,
      description: m.lms_settings_connections_description,
      icon: Link2,
      order: 10,
      component: preloadable(() => sections().then((s) => ({ default: s.ConnectionsSection }))),
    },
    {
      id: 'lms-sync',
      level: 'account',
      group: 'lms',
      title: m.lms_settings_sync,
      description: m.lms_settings_sync_description,
      icon: RefreshCw,
      order: 20,
      namespace: 'lms',
    },
    {
      id: 'program-lms',
      level: 'program',
      group: 'lms',
      title: m.lms_settings_program,
      description: m.lms_settings_program_description,
      icon: Link2,
      order: 10,
      component: preloadable(() => sections().then((s) => ({ default: s.ProgramLmsSection }))),
    },
    {
      id: 'course-lms',
      level: 'course',
      group: 'lms',
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
      Mark: CalendarMark,
      open: {
        Label: CalendarOpenLabel,
        icon: ExternalLink,
        // Platform data: only web links are opened (the API drops the rest too).
        available: (occurrence) => /^https?:\/\//i.test(occurrence.meta?.url ?? ''),
        run: (occurrence) => {
          window.open(occurrence.meta?.url ?? '', '_blank', 'noopener,noreferrer')
        },
      },
    },
  ],
  extensions: {
    [LMS_PROVIDER_UI]: [canvasUi],
    [ONBOARDING_STEPS]: onboardingSteps,
    [TERM_WIZARD_IMPORT_SOURCES]: [wizardCourseSource],
    [ASSESSMENT_IMPORT_SOURCES]: [assignmentSource],
    [ASSESSMENT_ACTIONS]: [bindAction, unbindAction],
    [COURSE_INFO_ROWS]: [{ id: 'lms.link', order: 100, component: CourseInfoLms }],
    [COURSE_GRADES_BANNERS]: [{ id: 'lms.updates', component: LmsUpdatesBanner }],
    [TASK_DETAIL_SECTIONS]: [
      { id: 'lms.assignment', Component: TaskSubmission },
    ] satisfies TaskDetailSection[],
  },
  uiPrefPrefixes: ['lms.'],
  realtimeInvalidations: {
    ...Object.fromEntries(CONNECTION_EVENTS.map((event) => [event, LMS_QUERIES])),
    ...Object.fromEntries(STATE_EVENTS.map((event) => [event, LMS_STATE_QUERIES])),
    ...Object.fromEntries(
      LINK_EVENTS.map((event) => [event, [...LMS_STATE_QUERIES, 'lmsTermAnnouncementList']]),
    ),
    // An import committed: what the course reports as new, and its assignments' "imported as".
    'lms.course.imports_recorded': [
      (data) => [
        ...LMS_STATE_QUERIES,
        { _id: 'lmsAssignmentList', path: { course_id: data.course_id } },
      ],
    ],
  },
})
