import {
  ArrowDownToLine,
  BellRing,
  ExternalLink,
  FolderSync,
  Link2,
  Megaphone,
  RefreshCw,
  School,
} from 'lucide-react'
import { lmsSyncRequest } from '@semestra/api-client'
import { defineModule, preloadable } from '@/app/extensions'
import type {
  AssignmentTargets,
  LmsProgramBindingGetResponse,
  LmsProviderListResponse,
  UnreadCounts,
} from '@semestra/api-client'
import {
  lmsAnnouncementListOptions,
  lmsAnnouncementUnreadOptions,
  lmsProgramBindingGetOptions,
  lmsProviderListOptions,
  lmsTermAnnouncementListOptions,
  settingsValueGetOptions,
} from '@semestra/api-client/react-query'
import {
  COURSE_INFO_ROWS,
  MOBILE_COURSE_SECTIONS,
  MOBILE_OVERVIEW_SECTIONS,
  type MobileCourseSection,
  type MobileOverviewSection,
  ONBOARDING_STEPS,
  type OnboardingStep,
  TERM_WIZARD_IMPORT_SOURCES,
} from '@/modules/academics/types'
import {
  ASSESSMENT_ACTIONS,
  ASSESSMENT_COLUMNS,
  ASSESSMENT_IMPORT_SOURCES,
  MOBILE_ASSESSMENT_OPENERS,
  type MobileAssessmentOpener,
  type AssessmentColumn,
} from '@/modules/grading/types'
import { FILE_ITEM_ACTIONS, type FileItemAction } from '@/modules/files/types'
import {
  TASK_DETAIL_SECTIONS,
  TASK_LINKS,
  type TaskDetailSection,
  type TaskLink,
} from '@/modules/tasks/types'
import { m } from '@/paraglide/messages'
import {
  ANNOUNCEMENTS_PAGE,
  announcementLinksQuery,
  announcementSearch,
  hasAnnouncements,
} from './announcements'
import { assignmentHost } from './assignment/AssignmentHost'
import { bindAction, openAction, unbindAction } from './binding/actions'
import { OpenInPlatform, PlatformMark } from './components/PlatformMark'
import { CalendarNote } from './sync/CalendarNote'
import { assignmentTargetsOptions } from './assignment/queries'
import { progressOf } from './assignment/status'
import { AssessmentAssignmentCell } from './components/AssessmentAssignment'
import { prefetchCourseLink, prefetchCourseTools } from './course-info'
import { taskAssignmentLink } from './components/TaskAssignment'
import { assignmentSource, syllabusSource, wizardCourseSource } from './import/sources'
import { canvasUi } from './providers/canvas'
import {
  courseLinkTargets,
  LMS_KEPT_QUERIES,
  LMS_QUERIES,
  programStateTargets,
  settingsPrefetch,
} from './queries'
import { LMS_PROVIDER_UI } from './types'
import { hiddenExcept } from '@/modules/notifications/categories'
import { SYNC_LINE, hasSyncLine, syncStatusOptions } from './sync/status'
import { SyncOnOpen } from './sync/SyncOnOpen'
import { FIELD_ORIGINS, type FieldOrigin } from '@/components/field-origins'
import { openStatusPanel } from '@/app/host/status-panel'
import { toastError } from '@/lib/errors'

// A connection's change can change what every course reads; the rest only the LMS state.
const CONNECTION_EVENTS = [
  'lms.connection.created',
  'lms.connection.updated',
  'lms.connection.deleted',
  'lms.connection.status_changed',
] as const
// Linking or unlinking also changes which courses the term announcements card reads.
const LINK_EVENTS = ['lms.course.linked', 'lms.course.unlinked'] as const

/** The assignment details (M09 §7.3): a dialog, on a phone a page that slides up. */
const AssignmentDetails = {
  desktop: assignmentHost(preloadable(() => import('./assignment/AssignmentDialog'))),
  phone: assignmentHost(preloadable(() => import('./mobile/AssignmentSheet'))),
}

/** The platforms' own UI; a new platform is one more entry. */
const PROVIDER_UIS = [canvasUi]

/** A course's kept reads are of the platform course it is linked to: gone with that link. */
const ofCourse = (data: Readonly<Record<string, unknown>>) => [
  { path: { course_id: data.course_id } },
]

const sections = () => import('./settings/sections')

/**
 * The `lms` namespace shows as two sections: General (how often courses sync, what Semestra may
 * change on the platform, how its content shows) and Assignments (what follows the platform
 * without asking, the to-dos it completes). Each hides the fields of the other.
 */
const LMS_FIELDS = {
  general: ['sync_every', 'allow_writes', 'display'],
  assignments: [
    'follow_title',
    'follow_due_at',
    'follow_weight',
    'follow_score',
    'complete_submitted',
  ],
} as const

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
  overlays: [SyncOnOpen, AssignmentDetails],
  pages: [
    {
      id: ANNOUNCEMENTS_PAGE,
      scopes: ['course', 'term'],
      title: m.lms_announcements_page_title,
      icon: Megaphone,
      order: 40,
      component: preloadable(() => import('./pages/AnnouncementsPage')),
      mobile: { component: preloadable(() => import('./mobile/AnnouncementsMobile')) },
      availabilityQuery: announcementLinksQuery,
      isAvailable: hasAnnouncements,
      unread: {
        // A course counts from its Program's numbers, so its courses share one request.
        query: (scope) =>
          scope.kind === 'course' || scope.kind === 'term'
            ? lmsAnnouncementUnreadOptions({
                path: { program_id: scope.programId },
                query: scope.kind === 'term' ? { term_id: scope.termId } : undefined,
              })
            : null,
        count: (scope, data) =>
          (data as UnreadCounts).items
            .filter((c) => scope.kind !== 'course' || c.course_id === scope.courseId)
            .reduce((sum, c) => sum + c.unread, 0),
      },
      prefetch: (scope, queryClient) => {
        // The display setting decides how the first announcement opened looks.
        void queryClient.prefetchQuery(settingsValueGetOptions({ path: { namespace: 'lms' } }))
        if (scope.kind === 'course') {
          void queryClient.prefetchQuery(
            lmsAnnouncementListOptions({ path: { course_id: scope.courseId } }),
          )
        } else if (scope.kind === 'term') {
          void queryClient.prefetchQuery(
            lmsTermAnnouncementListOptions({ path: { term_id: scope.termId } }),
          )
        }
      },
    },
  ],
  searchProviders: [announcementSearch],
  statusItems: [
    {
      id: SYNC_LINE,
      order: 40,
      load: () => import('./sync/line').then((line) => line.useSyncLine),
    },
  ],
  commands: [
    {
      id: 'lms.sync',
      title: m.lms_sync_command_title,
      keywords: ['lms', ...PROVIDER_UIS.map((ui) => ui.kind), 'sync', '同步'],
      icon: RefreshCw,
      isAvailable: ({ programId, queryClient }) =>
        Boolean(
          programId && hasSyncLine(queryClient.getQueryData(syncStatusOptions(programId).queryKey)),
        ),
      run: async ({ programId }) => {
        if (!programId) return
        openStatusPanel(SYNC_LINE)
        try {
          await lmsSyncRequest({
            path: { program_id: programId },
            body: { force: true },
            throwOnError: true,
          })
        } catch (error) {
          toastError(error)
        }
      },
    },
  ],
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
      prefetch: settingsPrefetch.connections,
    },
    {
      id: 'lms-general',
      level: 'account',
      group: 'lms',
      title: m.lms_settings_general,
      icon: RefreshCw,
      order: 20,
      namespace: 'lms',
      // How often courses sync, what Semestra may change on the platform, how its content shows.
      fields: { hidden: [...LMS_FIELDS.assignments] },
    },
    {
      id: 'lms-materials',
      level: 'account',
      group: 'lms',
      title: m.lms_settings_materials,
      description: m.lms_settings_materials_description,
      icon: FolderSync,
      order: 25,
      component: preloadable(() => sections().then((s) => ({ default: s.MaterialsSection }))),
      prefetch: settingsPrefetch.materials,
    },
    {
      id: 'lms-follow',
      level: 'account',
      group: 'lms',
      title: m.lms_settings_follow,
      description: m.lms_settings_follow_description,
      icon: ArrowDownToLine,
      order: 30,
      namespace: 'lms',
      // What follows the platform, then the to-do it completes.
      fields: { hidden: [...LMS_FIELDS.general] },
    },
    {
      id: 'lms-notify',
      level: 'account',
      group: 'lms',
      title: m.lms_settings_notify,
      icon: BellRing,
      order: 35,
      // The same setting as in Notifications, where it is one of the activity kinds.
      namespace: 'notifications',
      fields: { hidden: hiddenExcept(['lms']) },
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
      prefetch: settingsPrefetch.program,
    },
    {
      id: 'program-lms-courses',
      level: 'program',
      group: 'lms',
      title: m.lms_settings_program_courses,
      description: m.lms_settings_program_courses_description,
      icon: Link2,
      order: 20,
      component: preloadable(() => sections().then((s) => ({ default: s.ProgramCoursesSection }))),
      prefetch: settingsPrefetch.programCourses,
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
      prefetch: settingsPrefetch.course,
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
      Mark: PlatformMark,
      Note: CalendarNote,
      open: {
        Label: OpenInPlatform,
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
    [LMS_PROVIDER_UI]: PROVIDER_UIS,
    [ONBOARDING_STEPS]: onboardingSteps,
    [TERM_WIZARD_IMPORT_SOURCES]: [wizardCourseSource],
    [ASSESSMENT_IMPORT_SOURCES]: [assignmentSource, syllabusSource],
    [ASSESSMENT_ACTIONS]: [openAction, bindAction, unbindAction],
    [MOBILE_ASSESSMENT_OPENERS]: [
      { id: 'lms.assignment', Opener: preloadable(() => import('./mobile/AssessmentOpener')) },
    ] satisfies MobileAssessmentOpener[],
    [MOBILE_COURSE_SECTIONS]: [
      { id: 'lms.sync', order: 0, component: preloadable(() => import('./mobile/SyncSection')) },
    ] satisfies MobileCourseSection[],
    [MOBILE_OVERVIEW_SECTIONS]: [
      {
        id: 'lms.platform',
        order: 90,
        component: preloadable(() => import('./mobile/PlatformSection')),
      },
    ] satisfies MobileOverviewSection[],
    // Only in a gradebook where some assessment is an assignment of the platform (imported, or
    // kept from when it was): each such row opens the assignment's details, or its feedback.
    [ASSESSMENT_COLUMNS]: [
      {
        id: 'lms.assignment',
        header: m.lms_assignment_column,
        Cell: AssessmentAssignmentCell,
        query: ({ programId }) => assignmentTargetsOptions(programId),
        shownFor: (assessments, targets) =>
          assessments.some((a) => targets?.items.some((t) => t.assessment_id === a.id)),
        // How the assignment stands on the platform sorts the row into the filters. Not known
        // when the sync hasn't read the submission yet, or for one kept after unbinding (it no
        // longer follows the assignment): its due date decides.
        progress: (assessment, targets) => {
          const t = targets?.items.find((x) => x.assessment_id === assessment.id && !x.held)
          return t && t.state !== null ? progressOf(t.state, t.due_state ?? 'none') : undefined
        },
      },
    ] satisfies AssessmentColumn<AssignmentTargets>[],
    [FIELD_ORIGINS]: [
      { id: 'lms.sync', Button: preloadable(() => import('./sync/FollowButton')) },
    ] satisfies FieldOrigin[],
    [COURSE_INFO_ROWS]: [
      {
        id: 'lms.link',
        order: 100,
        component: preloadable(() => import('./components/CourseInfoLms')),
        prefetch: prefetchCourseLink,
      },
      {
        id: 'lms.links',
        order: 110,
        component: preloadable(() => import('./components/CourseLinks')),
        prefetch: prefetchCourseTools,
      },
    ],
    // What the sync brought in from the platform, opened there (pages and files, not links:
    // a link's address is already where it leads).
    [FILE_ITEM_ACTIONS]: [
      {
        id: 'lms.open',
        Label: OpenInPlatform,
        icon: ExternalLink,
        accepts: (item) =>
          item.source_kind === 'lms' &&
          item.kind === 'file' &&
          /^https?:\/\//i.test(item.url ?? ''),
        run: ({ item }) => {
          window.open(item.url ?? '', '_blank', 'noopener,noreferrer')
        },
      },
    ] satisfies FileItemAction[],
    [TASK_DETAIL_SECTIONS]: [
      { id: 'lms.assignment', Component: preloadable(() => import('./components/TaskSubmission')) },
    ] satisfies TaskDetailSection[],
    [TASK_LINKS]: [taskAssignmentLink] satisfies TaskLink[],
  },
  uiPrefPrefixes: ['lms.'],
  keptQueries: {
    operations: LMS_KEPT_QUERIES,
    dropOn: {
      'lms.course.linked': ofCourse,
      'lms.course.unlinked': ofCourse,
      // Its courses' links go with it.
      'lms.connection.deleted': () => [{}],
    },
  },
  realtimeInvalidations: {
    // Every read goes through the connection's credentials and address.
    ...Object.fromEntries(CONNECTION_EVENTS.map((event) => [event, LMS_QUERIES])),
    // The Program's connection was set, changed or cleared.
    'lms.program.bound': [(data) => programStateTargets(String(data.program_id))],
    ...Object.fromEntries(
      LINK_EVENTS.map((event) => [
        event,
        [(data) => courseLinkTargets(String(data.course_id), data.program_id)],
      ]),
    ),
    // A course's sync was switched, or the sync read its name, code and term afresh: its link,
    // the overview that shows them, the Program's list of links and what the sync covers.
    'lms.course.link_updated': [
      (data) => [
        { _id: 'lmsCourseLinkGet', path: { course_id: data.course_id } },
        { _id: 'lmsCourseOverview', path: { course_id: data.course_id } },
        'lmsCourseLinkList',
        'lmsSyncStatus',
      ],
    ],
    // A course's files changed: how many of its materials are kept locally or read online (what
    // unlinking it would do to them).
    ...Object.fromEntries(
      ['files.item.created', 'files.item.updated', 'files.item.deleted'].map((event) => [
        event,
        [
          (data: { course_id?: unknown }) =>
            typeof data.course_id === 'string'
              ? [{ _id: 'lmsCourseLinkGet', path: { course_id: data.course_id } }]
              : ['lmsCourseLinkGet'],
          'lmsMaterialCountLeft',
        ],
      ]),
    ),
    // Materials turned off or on: what the sync left behind (M09 §4.2).
    'settings.values.updated': ['lmsMaterialCountLeft'],
    // Which courses a term has: the term's links and announcements.
    'academics.course.terms_changed': ['lmsCourseLinkList', 'lmsTermAnnouncementList'],
    // The sync was queued, ran or was answered: its status line, panel and reminders.
    'lms.sync.updated': [
      (data) => [{ _id: 'lmsSyncStatus', path: { program_id: data.program_id } }],
    ],
    // The sync stored a course's announcements, or one was read: the lists and unread counts.
    'lms.announcement.updated': [
      (data) => [
        { _id: 'lmsAnnouncementList', path: { course_id: data.course_id } },
        'lmsTermAnnouncementList',
        { _id: 'lmsAnnouncementUnread', path: { program_id: data.program_id } },
      ],
    ],
    // A course synced: its link (when, errors) and the assignments the sync read afresh.
    'lms.course.synced': [
      (data) => [
        'lmsCourseLinkList',
        { _id: 'lmsCourseLinkGet', path: { course_id: data.course_id } },
        { _id: 'lmsAssignmentList', path: { course_id: data.course_id } },
        { _id: 'lmsAssignmentGet', path: { course_id: data.course_id } },
      ],
    ],
    // The sync changed what it keeps of a course's assignments (M09 §3.1): the course's list and
    // details, and the Program's assessments and to-dos that follow them.
    'lms.assignments.updated': [
      (data) => [
        { _id: 'lmsAssignmentList', path: { course_id: data.course_id } },
        { _id: 'lmsAssignmentGet', path: { course_id: data.course_id } },
        { _id: 'lmsAssignmentTargets', path: { program_id: data.program_id } },
      ],
    ],
    // An assignment was imported, bound or unbound: what the course reports as new, its
    // assignments' "imported as", and which assessments and to-dos follow an assignment.
    'lms.course.imports_recorded': [
      (data) => [
        { _id: 'lmsCourseLinkGet', path: { course_id: data.course_id } },
        { _id: 'lmsAssignmentList', path: { course_id: data.course_id } },
        { _id: 'lmsAssignmentGet', path: { course_id: data.course_id } },
        'lmsAssignmentTargets',
      ],
    ],
  },
  // Caused here, already applied: opening an announcement marks it read in the lists at once
  // and refetches the unread counts itself (`useMarkRead`); the Program's connection is
  // refetched by the section that set it.
  realtimeSkipOwn: ['lms.announcement.updated', 'lms.program.bound'],
})
