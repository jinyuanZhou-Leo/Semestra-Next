import {
  lmsAssignmentListOptions,
  lmsCourseLinkGetOptions,
  lmsTermNewAssignmentsOptions,
} from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { ClipboardList } from 'lucide-react'
import { useState } from 'react'
import { toastError } from '@/lib/errors'
import { useCurrentTerm } from '@/modules/academics/current-term'
import { m } from '@/paraglide/messages'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/ui/alert'
import { Button } from '@/ui/button'
import { importAssignments } from '../import/assignments'
import { useProgramProviderName, useProviderName } from '../providers'

type Course = { courseId: string; externalIds: string[]; names: string[] }

/**
 * "N new assignments on {provider}" with one button that imports them (M09 §4): assignments
 * that are due later and not in Semestra yet. Course by course; a course whose import needs a
 * decision opens its review before the next one.
 */
function NewAssignments({ courses, provider }: { courses: Course[]; provider: string }) {
  const [importing, setImporting] = useState(false)
  const count = courses.reduce((sum, c) => sum + c.externalIds.length, 0)
  if (count === 0) return null

  const run = async () => {
    setImporting(true)
    for (const course of courses) {
      try {
        await importAssignments(course.courseId, course.externalIds, provider)
      } catch (error) {
        toastError(error)
        break
      }
    }
    setImporting(false)
  }

  return (
    <Alert>
      <ClipboardList aria-hidden />
      <AlertTitle>{m.lms_new_assignments({ count, provider })}</AlertTitle>
      <AlertDescription>
        {courses
          .flatMap((c) => c.names)
          .slice(0, 3)
          .join(' · ')}
      </AlertDescription>
      <AlertAction>
        <Button size="sm" variant="outline" disabled={importing} onClick={() => void run()}>
          {m.lms_new_assignments_import()}
        </Button>
      </AlertAction>
    </Alert>
  )
}

/** On a course's Canvas page (M16): the course's new assignments, from the list it shows. */
export function LmsNewAssignmentsBanner({ courseId }: { courseId: string }) {
  const link = useQuery(lmsCourseLinkGetOptions({ path: { course_id: courseId } })).data?.link
  const list = useQuery({
    ...lmsAssignmentListOptions({ path: { course_id: courseId } }),
    enabled: Boolean(link?.sync_enabled),
    retry: false,
  }).data
  const provider = useProviderName(link?.provider) ?? ''
  if (!link?.sync_enabled || !list) return null
  const names = new Map(list.items.map((a) => [a.external_id, a.name]))
  const course = {
    courseId,
    externalIds: list.new_ids,
    names: list.new_ids.map((id) => names.get(id) ?? ''),
  }
  return <NewAssignments courses={[course]} provider={provider} />
}

/** On the "today" page (`schedule.todayBanners`): every linked course of the current term. */
export function LmsTermNewAssignmentsBanner({ programId }: { programId: string }) {
  const termId = useCurrentTerm(programId).autoTerm?.id
  const provider = useProgramProviderName(programId) ?? ''
  const data = useQuery({
    ...lmsTermNewAssignmentsOptions({ path: { term_id: termId ?? '' } }),
    enabled: Boolean(termId),
    staleTime: 5 * 60_000,
    retry: false,
  }).data
  if (!data) return null
  const courses = data.items.map((c) => ({
    courseId: c.course_id,
    externalIds: c.external_ids,
    names: c.names,
  }))
  return <NewAssignments courses={courses} provider={provider} />
}
