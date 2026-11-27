import {
  academicsCourseGetOptions,
  academicsCourseListOptions,
  lmsConnectionListOptions,
  lmsCourseLinkGetOptions,
  lmsCourseLinkListOptions,
  lmsCourseListOptions,
  lmsProgramBindingGetOptions,
  lmsProviderListOptions,
  settingsSchemaListOptions,
  settingsValueGetOptions,
  lmsMaterialCountLeftOptions,
} from '@semestra/api-client/react-query'
import { partialMatchKey, type Query, type QueryClient } from '@tanstack/react-query'
import type { QueryMatch, Scope } from '@/app/extensions'

/**
 * Generated query ids of the LMS state: connections, bindings, links, the platform's course
 * list, a course's overview and the Program's sync status.
 */
const LMS_STATE_QUERIES = [
  'lmsConnectionList',
  'lmsProgramBindingGet',
  'lmsCourseList',
  'lmsCourseLinkGet',
  'lmsCourseLinkList',
  'lmsCourseOverview',
  'lmsSyncStatus',
  // Which assessments and to-dos are an assignment of the platform.
  'lmsAssignmentTargets',
  'lmsAnnouncementUnread',
  // What turning the materials sync off left in the course files.
  'lmsMaterialCountLeft',
]

/** What linked courses hold on the platform. */
const LMS_CONTENT_QUERIES = [
  'lmsAssignmentList',
  'lmsAnnouncementList',
  'lmsTermAnnouncementList',
  'lmsModuleList',
  'lmsModuleItemList',
  'lmsPageList',
  'lmsPageGet',
  'lmsQuizList',
  'lmsSyllabusGet',
  'lmsFileGet',
  'lmsAssignmentGet',
  'lmsFolderGet',
  'lmsFileSearch',
  'lmsFilePreview',
]

export const LMS_QUERIES = [...LMS_STATE_QUERIES, ...LMS_CONTENT_QUERIES]

/**
 * What a course's platform pages show (the provider's tab, cards, pickers), kept in the browser
 * between visits (`keptQueries`): opened again, a view shows what it showed last time at once
 * and fetches the platform's current state behind it. Only reads that go to the platform: what
 * the sync keeps (assignments, announcements) reads quickly from the app's own data, and a kept copy would
 * show an old list (and old unread marks) before the current one.
 */
export const LMS_KEPT_QUERIES = [
  'lmsCourseOverview',
  'lmsQuizList',
  'lmsModuleList',
  'lmsModuleItemList',
  'lmsPageList',
  'lmsPageGet',
  'lmsSyllabusGet',
  'lmsFolderGet',
]

/** hey-api's query key: `_id` is the operation, `path` its path parameters. */
function keyOf(query: Query) {
  return query.queryKey[0] as { _id?: unknown; path?: { course_id?: unknown } } | undefined
}

function idOf(query: Query) {
  // oxlint-disable-next-line no-underscore-dangle -- hey-api's query key field
  const id = keyOf(query)?._id
  return typeof id === 'string' ? id : null
}

/** One course's platform reads, and the term card that lists its announcements. */
export function isCourseContent(courseId: string) {
  return (query: Query) => {
    const id = idOf(query)
    if (id === null || !LMS_CONTENT_QUERIES.includes(id)) return false
    return id === 'lmsTermAnnouncementList' || keyOf(query)?.path?.course_id === courseId
  }
}

/**
 * What a change of the Program's connection (bound, changed, cleared) makes stale: the Program's
 * LMS state, and every course's link state, which names the Program's connection.
 */
export function programStateTargets(programId: string): QueryMatch[] {
  const path = { program_id: programId }
  return [
    { _id: 'lmsProgramBindingGet', path },
    { _id: 'lmsCourseList', path },
    { _id: 'lmsCourseLinkList', path },
    { _id: 'lmsSyncStatus', path },
    { _id: 'lmsAssignmentTargets', path },
    { _id: 'lmsAnnouncementUnread', path },
    { _id: 'lmsCourseLinkGet' },
    { _id: 'lmsMaterialCountLeft' },
  ]
}

/**
 * What linking or unlinking a course makes stale: its link and platform reads, and the Program's
 * lists that count its courses (links, the platform's courses offered for linking, the sync, the
 * assignments followed, unread announcements and the term's announcements).
 */
export function courseLinkTargets(courseId: string, programId?: unknown): QueryMatch[] {
  const program = typeof programId === 'string' ? { path: { program_id: programId } } : {}
  return [
    ...courseReadTargets(courseId),
    { _id: 'lmsCourseLinkGet', path: { course_id: courseId } },
    { _id: 'lmsMaterialCountLeft' },
    { _id: 'lmsTermAnnouncementList' },
    ...['lmsCourseLinkList', 'lmsCourseList', 'lmsSyncStatus', 'lmsAssignmentTargets'].map(
      (id) => ({ _id: id, ...program }),
    ),
    { _id: 'lmsAnnouncementUnread', ...program },
  ]
}

/** What a course's platform pages read: its overview and contents (the Canvas tab's "Refresh"). */
export function courseReadTargets(courseId: string): QueryMatch[] {
  return [...LMS_CONTENT_QUERIES, 'lmsCourseOverview'].map((id) => ({
    _id: id,
    path: { course_id: courseId },
  }))
}

/** Refetches the queries `targets` names (the same matches an SSE event's targets give). */
export function invalidateTargets(queryClient: QueryClient, targets: readonly QueryMatch[]) {
  return queryClient.invalidateQueries({
    predicate: (query) => targets.some((target) => partialMatchKey(query.queryKey, [target])),
  })
}

/**
 * Refetches every LMS read: a connection's credentials or config changed, which every course
 * linked through it reads with.
 */
export function invalidateLms(queryClient: QueryClient) {
  return queryClient.invalidateQueries({
    predicate: (query) => {
      const id = idOf(query)
      return id !== null && LMS_QUERIES.includes(id)
    },
  })
}

const bindingOf = (scope: Scope | undefined, queryClient: QueryClient) =>
  queryClient.ensureQueryData(
    lmsProgramBindingGetOptions({ path: { program_id: scope?.programId ?? '' } }),
  )

/** `prefetch` of the LMS settings sections (M11 §5.2). */
/** The settings namespace of how courses take in their materials (Program and course levels). */
export const MATERIALS = 'lms.materials'

/** What the materials form of the account or course LMS section shows (the same queries). */
const materialSettings = (
  query: { scope_type: 'account' } | { scope_type: 'course'; scope_id: string },
  queryClient: QueryClient,
) =>
  Promise.all([
    queryClient.ensureQueryData({ ...settingsSchemaListOptions(), staleTime: Infinity }),
    queryClient.ensureQueryData(settingsValueGetOptions({ path: { namespace: MATERIALS }, query })),
  ])

export const settingsPrefetch = {
  connections: (_scope: unknown, queryClient: QueryClient) =>
    Promise.all([
      queryClient.ensureQueryData(lmsConnectionListOptions()),
      queryClient.ensureQueryData(lmsProviderListOptions()),
    ]),
  materials: (_scope: unknown, queryClient: QueryClient) =>
    Promise.all([
      queryClient.ensureQueryData(lmsConnectionListOptions()),
      materialSettings({ scope_type: 'account' }, queryClient),
      queryClient.ensureQueryData(lmsMaterialCountLeftOptions()),
    ]),
  program: (scope: Scope | undefined, queryClient: QueryClient) =>
    Promise.all([
      queryClient.ensureQueryData(lmsConnectionListOptions()),
      bindingOf(scope, queryClient),
    ]),
  // The Program's courses and their links; the platform's courses (for suggestions) come after.
  programCourses: async (scope: Scope | undefined, queryClient: QueryClient) => {
    const programId = scope?.programId ?? ''
    const path = { path: { program_id: programId } }
    const [binding] = await Promise.all([
      bindingOf(scope, queryClient),
      queryClient.ensureQueryData(academicsCourseListOptions({ ...path, query: { limit: 500 } })),
    ])
    if (binding?.connection_id) {
      await queryClient.ensureQueryData(lmsCourseLinkListOptions(path))
    }
  },
  // A linked course shows its link; an unlinked one the platform's courses to pick from; one in an
  // unbound Program a way to connect.
  course: async (scope: Scope | undefined, queryClient: QueryClient) => {
    const courseId = scope?.kind === 'course' ? scope.courseId : ''
    const [state] = await Promise.all([
      queryClient.ensureQueryData(lmsCourseLinkGetOptions({ path: { course_id: courseId } })),
      bindingOf(scope, queryClient),
    ])
    if (!state.program_connection_id) {
      return queryClient.ensureQueryData(lmsConnectionListOptions())
    }
    const materials = materialSettings({ scope_type: 'course', scope_id: courseId }, queryClient)
    if (state.link) {
      return Promise.all([
        materials,
        queryClient.ensureQueryData(
          lmsMaterialCountLeftOptions({ query: { course_id: courseId } }),
        ),
      ])
    }
    return Promise.all([
      materials,
      queryClient.ensureQueryData(academicsCourseGetOptions({ path: { course_id: courseId } })),
      queryClient.ensureQueryData(
        lmsCourseListOptions({
          path: { program_id: scope?.programId ?? '' },
          query: { include_past: false },
        }),
      ),
    ])
  },
}
