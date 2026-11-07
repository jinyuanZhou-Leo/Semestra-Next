import {
  lmsAssignmentListOptions,
  lmsTermNewAssignmentsOptions,
} from '@semestra/api-client/react-query'
import { useQueries, useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useUiPref } from '@/app/ui-pref'
import { toastError } from '@/lib/errors'
import { useCurrentTerm } from '@/modules/academics/current-term'
import { m } from '@/paraglide/messages'
import { importAssignments } from '../import/assignments'
import { useProgramProviderName } from '../providers'

type Course = { courseId: string; externalIds: string[] }

const NO_KEYS: string[] = []

/** `courseId:externalId`: what "Ignore" remembers. */
const keysOf = (courses: Course[]) =>
  courses.flatMap((c) => c.externalIds.map((id) => `${c.courseId}:${id}`))

/**
 * The new assignments of the current term's linked courses (M09 §4): due later and not in
 * Semestra yet. The term's list answers from the cache; courses not read yet are read here side
 * by side.
 */
function useNewAssignments(programId: string): Course[] {
  const termId = useCurrentTerm(programId).autoTerm?.id
  const term = useQuery({
    ...lmsTermNewAssignmentsOptions({ path: { term_id: termId ?? '' } }),
    enabled: Boolean(termId),
    staleTime: 5 * 60_000,
    retry: false,
  }).data
  const unread = useQueries({
    queries: (term?.unread ?? []).map((courseId) => ({
      ...lmsAssignmentListOptions({ path: { course_id: courseId } }),
      retry: false,
    })),
  })
  if (!term) return []
  const courses: Course[] = term.items.map((c) => ({
    courseId: c.course_id,
    externalIds: c.external_ids,
  }))
  const pending = term.unread ?? []
  for (const [index, courseId] of pending.entries()) {
    const ids = unread[index]?.data?.new_ids ?? []
    if (ids.length > 0) courses.push({ courseId, externalIds: ids })
  }
  return courses
}

function Reminder({ programId }: { programId: string }) {
  const provider = useProgramProviderName(programId) ?? ''
  const [ignored, setIgnored] = useUiPref('lms.newAssignmentsIgnored', NO_KEYS, {
    scope: programId,
  })
  const all = useNewAssignments(programId)
  const hidden = new Set(ignored)
  const courses = all
    .map((c) => ({
      ...c,
      externalIds: c.externalIds.filter((id) => !hidden.has(`${c.courseId}:${id}`)),
    }))
    .filter((c) => c.externalIds.length > 0)
  const count = courses.reduce((sum, c) => sum + c.externalIds.length, 0)
  const signature = keysOf(courses).join(',')
  // Each set of new assignments is announced once while the app is open.
  const announced = useRef('')

  useEffect(() => {
    if (count === 0 || announced.current === signature) return
    announced.current = signature
    const run = async () => {
      // Course by course: one that needs a decision opens its review before the next.
      for (const course of courses) {
        try {
          await importAssignments(course.courseId, course.externalIds, provider)
        } catch (error) {
          toastError(error)
          return
        }
      }
    }
    toast(m.lms_new_assignments({ count, provider }), {
      id: 'lms.newAssignments',
      duration: 15_000,
      action: { label: m.lms_new_assignments_import(), onClick: () => void run() },
      // Every assignment new now, so only later ones bring the reminder back.
      cancel: { label: m.lms_new_assignments_ignore(), onClick: () => setIgnored(keysOf(all)) },
    })
  })
  return null
}

/**
 * "N new assignments on {provider} · Import · Ignore" (M09 §4), rendered once for the signed-in
 * app (`overlays`): a toast, so it takes no room on any page. Shown in a Program, for its current
 * term; "Ignore" hides these assignments until new ones appear.
 */
export function NewAssignmentsToast() {
  const { programId } = useParams({ strict: false }) as { programId?: string }
  return programId ? <Reminder key={programId} programId={programId} /> : null
}
