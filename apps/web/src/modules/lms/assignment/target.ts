import { type AnyRouter, useLocation, useRouter } from '@tanstack/react-router'

/** The tab the details open on: the description, or the submission with the feedback. */
export type AssignmentView = 'details' | 'feedback'

/**
 * An assignment of a linked course, by the platform's id (`quiz:<id>` for a practice quiz).
 * `held` (`assessment:<id>` or `task:<id>`) opens what was kept for that assessment or to-do
 * after it stopped following the assignment (M09 §3.2).
 */
export type AssignmentTarget = {
  courseId: string
  assignmentId: string
  view: AssignmentView
  held?: string
}

const PARAM = 'assignment'
const VIEW_PARAM = 'view'
const HELD_PARAM = 'held'

type Place = { pathname: string; searchStr: string }

/** `<course>:<assignment>` → the target; anything else means the details are closed. */
export function parseAssignmentParam(
  value: string | null,
  view?: string | null,
  held?: string | null,
): AssignmentTarget | null {
  const at = value?.indexOf(':') ?? -1
  if (!value || at <= 0 || at === value.length - 1) return null
  return {
    courseId: value.slice(0, at),
    assignmentId: value.slice(at + 1),
    view: view === 'feedback' ? 'feedback' : 'details',
    ...(held && /^(assessment|task):./.test(held) ? { held } : {}),
  }
}

/** The page at `place` with the details of `target` open, or closed when there is none. */
export function assignmentHref(
  place: Place,
  target?: Pick<AssignmentTarget, 'courseId' | 'assignmentId' | 'held'> & {
    view?: AssignmentView
  },
): string {
  const params = new URLSearchParams(place.searchStr)
  if (target) params.set(PARAM, `${target.courseId}:${target.assignmentId}`)
  else params.delete(PARAM)
  if (target?.view === 'feedback') params.set(VIEW_PARAM, 'feedback')
  else params.delete(VIEW_PARAM)
  if (target?.held) params.set(HELD_PARAM, target.held)
  else params.delete(HELD_PARAM)
  const query = params.toString()
  return `${place.pathname}${query ? `?${query}` : ''}`
}

/** Opens the details of an assignment over the page that is on screen. */
export function openAssignmentDetails(
  router: AnyRouter,
  courseId: string,
  assignmentId: string,
  view: AssignmentView = 'details',
  held?: string,
) {
  router.history.replace(
    assignmentHref(router.state.location, { courseId, assignmentId, view, held }),
  )
}

/**
 * The assignment details (M09 §7.3) live in the URL of whatever page is on screen
 * (`?assignment=<course>:<assignment>&view=feedback&held=<kind>:<id>`), so a link or a notification opens them and
 * a reload keeps them. Opening and closing replace the entry: the dialog is not a step of its own
 * in the history.
 */
export function useAssignmentDetails() {
  const router = useRouter()
  // Read when called, not subscribed: rows of a table each open details, and a hook that
  // followed the URL would re-render every one of them on any change of address.
  return {
    open: (courseId: string, assignmentId: string, view: AssignmentView = 'details', held?: string) =>
      openAssignmentDetails(router, courseId, assignmentId, view, held),
    close: () => router.history.replace(assignmentHref(router.state.location)),
  }
}

/** Which details are open, following the URL: for the one host that shows them. */
export function useOpenAssignmentTarget(): AssignmentTarget | null {
  const { searchStr } = useLocation()
  const search = new URLSearchParams(searchStr)
  return parseAssignmentParam(search.get(PARAM), search.get(VIEW_PARAM), search.get(HELD_PARAM))
}
