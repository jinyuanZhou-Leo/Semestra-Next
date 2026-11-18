import {
  ArrowDownToLine,
  ExternalLink,
  Link2,
  ListChecks,
  Megaphone,
  RefreshCw,
  School,
  ShieldCheck,
} from 'lucide-react'
import { lmsSyncRequest } from '@semestra/api-client'
import { defineModule, preloadable } from '@/app/extensions'
import type {
  CourseLinkState,
  LmsProgramBindingGetResponse,
  LmsProviderListResponse,
  UnreadCounts,
} from '@semestra/api-client'
import {
  lmsAnnouncementListOptions,
  lmsAnnouncementUnreadOptions,
  lmsCourseLinkGetOptions,
  lmsProgramBindingGetOptions,
  lmsProviderListOptions,
  lmsTermAnnouncementListOptions,
} from '@semestra/api-client/react-query'
import {
  COURSE_INFO_ROWS,
  ONBOARDING_STEPS,
  type OnboardingStep,
  TERM_WIZARD_IMPORT_SOURCES,
} from '@/modules/academics/types'
import {
  ASSESSMENT_ACTIONS,
  ASSESSMENT_COLUMNS,
  ASSESSMENT_IMPORT_SOURCES,
  type AssessmentColumn,
} from '@/modules/grading/types'
import { FILE_ITEM_ACTIONS, type FileItemAction } from '@/modules/files/types'
import { TASK_DETAIL_SECTIONS, type TaskDetailSection } from '@/modules/tasks/types'
import { m } from '@/paraglide/messages'
import {
  ANNOUNCEMENTS_PAGE,
  announcementLinksQuery,
  announcementSearch,
  hasAnnouncements,
} from './announcements'
import { bindAction, unbindAction } from './binding/actions'
import { OpenInPlatform, PlatformMark } from './components/PlatformMark'
import { CourseInfoLms } from './components/CourseInfoLms'
import { AssessmentFeedbackCell } from './components/AssessmentFeedback'
import { CourseLinks } from './components/CourseLinks'
import { prefetchCourseLink, prefetchCourseTools } from './course-info'
import TaskSubmission from './components/TaskSubmission'
import { assignmentSource, wizardCourseSource } from './import/sources'
import { canvasUi } from './providers/canvas'
import { LMS_KEPT_QUERIES, LMS_QUERIES, LMS_STATE_QUERIES, settingsPrefetch } from './queries'
import { LMS_PROVIDER_UI } from './types'
import { SYNC_LINE, hasSyncLine, syncStatusOptions, useSyncLine } from './sync/status'
import { SyncOnOpen } from './sync/SyncOnOpen'
import { FollowButton } from './sync/FollowButton'
import { FIELD_ORIGINS, type FieldOrigin } from '@/components/FieldOrigins'
import { openStatusPanel } from '@/app/host/status-panel'
import { toastError } from '@/lib/errors'

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

/** The platforms' own UI; a new platform is one more entry. */
const PROVIDER_UIS = [canvasUi]

/** A course's kept reads are of the platform course it is linked to: gone with that link. */
const ofCourse = (data: Readonly<Record<string, unknown>>) => [
  { path: { course_id: data.course_id } },
]

const sections = () => import('./settings/sections')

/**
 * The `lms` namespace shows as four sections: background sync, what follows the platform without
 * asking, to-dos, writes. Each hides the fields of the others.
 */
const LMS_FIELDS = {
  sync: ['sync_every'],
  follow: ['follow_title', 'follow_due_at', 'follow_weight', 'follow_score'],
  todos: ['complete_submitted'],
  writes: ['allow_writes'],
} as const
const showOnly = (part: keyof typeof LMS_FIELDS) => ({
  hidden: Object.entries(LMS_FIELDS).flatMap(([key, fields]) => (key === part ? [] : fields)),
})

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
  overlays: [SyncOnOpen],
  pages: [
    {
      id: ANNOUNCEMENTS_PAGE,
      scopes: ['course', 'term'],
      title: m.lms_announcements_page_title,
      icon: Megaphone,
      order: 40,
      component: preloadable(() => import('./pages/AnnouncementsPage')),
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
  statusItems: [{ id: SYNC_LINE, order: 40, useStatus: useSyncLine }],
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
      id: 'lms-sync',
      level: 'account',
      group: 'lms',
      title: m.lms_settings_sync,
      description: m.lms_settings_sync_description,
      icon: RefreshCw,
      order: 20,
      namespace: 'lms',
      fields: showOnly('sync'),
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
      fields: showOnly('follow'),
    },
    {
      id: 'lms-todos',
      level: 'account',
      group: 'lms',
      title: m.lms_settings_todos,
      icon: ListChecks,
      order: 35,
      namespace: 'lms',
      fields: showOnly('todos'),
    },
    {
      id: 'lms-writes',
      level: 'account',
      group: 'lms',
      title: m.lms_settings_writes,
      description: m.lms_settings_writes_description,
      icon: ShieldCheck,
      order: 40,
      namespace: 'lms',
      fields: showOnly('writes'),
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
    [ASSESSMENT_IMPORT_SOURCES]: [assignmentSource],
    [ASSESSMENT_ACTIONS]: [bindAction, unbindAction],
    // Only in the gradebook of a linked course where some assessments follow an LMS assignment
    // (an unlinked course's imported ones keep their origin but have no platform to read).
    [ASSESSMENT_COLUMNS]: [
      {
        id: 'lms.feedback',
        header: m.lms_feedback_column,
        Cell: AssessmentFeedbackCell,
        query: ({ courseId }) => lmsCourseLinkGetOptions({ path: { course_id: courseId } }),
        shownFor: (assessments, state) =>
          Boolean(state?.link) && assessments.some((a) => a.source_kind === 'lms'),
      },
    ] satisfies AssessmentColumn<CourseLinkState>[],
    [FIELD_ORIGINS]: [{ id: 'lms.sync', Button: FollowButton }] satisfies FieldOrigin[],
    [COURSE_INFO_ROWS]: [
      { id: 'lms.link', order: 100, component: CourseInfoLms, prefetch: prefetchCourseLink },
      { id: 'lms.links', order: 110, component: CourseLinks, prefetch: prefetchCourseTools },
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
      { id: 'lms.assignment', Component: TaskSubmission },
    ] satisfies TaskDetailSection[],
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
    ...Object.fromEntries(CONNECTION_EVENTS.map((event) => [event, LMS_QUERIES])),
    ...Object.fromEntries(STATE_EVENTS.map((event) => [event, LMS_STATE_QUERIES])),
    ...Object.fromEntries(
      LINK_EVENTS.map((event) => [event, [...LMS_STATE_QUERIES, 'lmsTermAnnouncementList']]),
    ),
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
        ],
      ]),
    ),
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
      ],
    ],
    // An import committed: what the course reports as new, and its assignments' "imported as".
    'lms.course.imports_recorded': [
      (data) => [
        ...LMS_STATE_QUERIES,
        { _id: 'lmsAssignmentList', path: { course_id: data.course_id } },
      ],
    ],
  },
})
