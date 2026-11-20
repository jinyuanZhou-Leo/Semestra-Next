import { academicsCourseGetOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { toastError } from '@/lib/errors'
import { coursePath } from '@/modules/academics/paths'
import { useGradingScale } from '@/modules/grading/queries'
import type { LmsContent } from '../content/context'
import { useLmsDisplay } from '../content/display'
import { useLmsLinkOpener } from '../content/link-opener'
import { importAssignments } from '../import/assignments'
import { useProgramProviderName, useProviderName } from '../providers'
import { useAssignment } from './queries'
import type { AssignmentTarget } from './target'

/**
 * Everything the assignment details show and do (M09 §7.3), for the dialog and the phone's page:
 * the assignment, its course, the platform's name, where the description's links and the places
 * in Semestra lead, and the import of one not imported yet.
 */
export function useDetails(
  { courseId, assignmentId }: AssignmentTarget,
  onClose: () => void,
  /** Whether the app's pages are there to open links in (not on a phone, M17). */
  { pages = true }: { pages?: boolean } = {},
) {
  const navigate = useNavigate()
  const [now] = useState(Date.now)
  const course = useQuery(academicsCourseGetOptions({ path: { course_id: courseId } })).data
  const programId = course?.program_id ?? ''
  const assignment = useAssignment(courseId, assignmentId)
  const detail = assignment.data
  const kind = useProviderName(detail?.provider || null)
  const bound = useProgramProviderName(programId)
  const provider = kind ?? bound ?? ''
  const hideGrades = useGradingScale(programId).data?.hide_grades ?? false
  const { display, setDisplay } = useLmsDisplay()

  const go = (href: string) => void navigate({ href })
  const openLink = useLmsLinkOpener({ programId, courseId, targets: detail?.targets, pages })
  const content: LmsContent = { courseId, provider, display, setDisplay, openLink }

  const importable = Boolean(detail) && !assignment.practice && !detail?.kept
  return {
    ...assignment,
    detail,
    course,
    provider,
    hideGrades,
    content,
    now,
    openGrades: (assessmentId: string) =>
      go(
        `${coursePath(programId, courseId, 'grades')}?assessment=${encodeURIComponent(assessmentId)}`,
      ),
    openTasks: () => go(coursePath(programId, courseId, 'tasks')),
    /** Through the import review, which takes the screen: the details close for it. */
    startImport: importable
      ? () => {
          onClose()
          importAssignments(courseId, [detail?.assignment.external_id ?? ''], provider).catch(
            toastError,
          )
        }
      : undefined,
  }
}
