import { type AnyRouter, useLocation, useRouter } from '@tanstack/react-router'

/** The tab the details open on: the description, or the submission with the feedback. */
export type AssignmentView = 'details' | 'feedback'

/** An assignment of a linked course, by the platform's id (`quiz:<id>` for a practice quiz). */
export type AssignmentTarget = { courseId: string; assignmentId: string; view: AssignmentView }

const PARAM = 'assignment'
const VIEW_PARAM = 'view'

type Place = { pathname: string; searchStr: string }

/** `<course>:<assignment>` → the target; anything else means the details are closed. */
export function parseAssignmentParam(
  value: string | null,
  view?: string | null,
): AssignmentTarget | null {
  const at = value?.indexOf(':') ?? -1
  if (!value || at <= 0 || at === value.length - 1) return null
  return {
    courseId: value.slice(0, at),
    assignmentId: value.slice(at + 1),
    view: view === 'feedback' ? 'feedback' : 'details',
  }
}

/** The page at `place` with the details of `target` open, or closed when there is none. */
export function assignmentHref(
  place: Place,
  target?: Pick<AssignmentTarget, 'courseId' | 'assignmentId'> & { view?: AssignmentView },
): string {
  const params = new URLSearchParams(place.searchStr)
  if (target) params.set(PARAM, `${target.courseId}:${target.assignmentId}`)
  else params.delete(PARAM)
  if (target?.view === 'feedback') params.set(VIEW_PARAM, 'feedback')
  else params.delete(VIEW_PARAM)
  const query = params.toString()
  return `${place.pathname}${query ? `?${query}` : ''}`
}

/** Opens the details of an assignment over the page that is on screen. */
export function openAssignmentDetails(
  router: AnyRouter,
  courseId: string,
  assignmentId: string,
  view: AssignmentView = 'details',
) {
  router.history.replace(assignmentHref(router.state.location, { courseId, assignmentId, view }))
}

/**
 * The assignment details (M09 §7.3) live in the URL of whatever page is on screen
 * (`?assignment=<course>:<assignment>&view=feedback`), so a link or a notification opens them and
 * a reload keeps them. Opening and closing replace the entry: the dialog is not a step of its own
 * in the history.
 */
export function useAssignmentDetails() {
  const router = useRouter()
  const { pathname, searchStr } = useLocation()
  const search = new URLSearchParams(searchStr)
  const target = parseAssignmentParam(search.get(PARAM), search.get(VIEW_PARAM))
  const place = { pathname, searchStr }
  return {
    target,
    open: (courseId: string, assignmentId: string, view: AssignmentView = 'details') =>
      router.history.replace(assignmentHref(place, { courseId, assignmentId, view })),
    close: () => router.history.replace(assignmentHref(place)),
  }
}
