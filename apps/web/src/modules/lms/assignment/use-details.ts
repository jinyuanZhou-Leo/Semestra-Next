import { academicsCourseGetOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useExtensions } from '@/app/registry'
import type { InternalLink } from '@/components/SafeHtml'
import { toastError } from '@/lib/errors'
import { coursePath } from '@/modules/academics/paths'
import { filePath } from '@/modules/files/location'
import { useGradingScale } from '@/modules/grading/queries'
import { announcementPath } from '../announcements'
import type { LmsContent } from '../content/context'
import { useLmsDisplay } from '../content/display'
import { fileContentUrl } from '../content/file-url'
import { importAssignments } from '../import/assignments'
import { useProgramProviderName, useProviderName } from '../providers'
import { LMS_LINK_OPENERS, type LmsLinkOpener } from '../types'
import { PRACTICE, useAssignment } from './queries'
import { type AssignmentTarget, useAssignmentDetails } from './target'

/**
 * Everything the assignment details show and do (M09 §7.3), for the dialog and the phone's page:
 * the assignment, its course, the platform's name, where the description's links and the places
 * in Semestra lead, and the import of one not imported yet.
 */
export function useDetails({ courseId, assignmentId }: AssignmentTarget, onClose: () => void) {
  const navigate = useNavigate()
  const { open } = useAssignmentDetails()
  const [now] = useState(Date.now)
  const course = useQuery(academicsCourseGetOptions({ path: { course_id: courseId } })).data
  const programId = course?.program_id ?? ''
  const assignment = useAssignment(courseId, assignmentId)
  const detail = assignment.data
  const kind = useProviderName(detail?.provider || null)
  const bound = useProgramProviderName(programId)
  const provider = kind ?? bound ?? ''
  const hideGrades = useGradingScale(programId).data?.hide_grades ?? false
  const openers = useExtensions<LmsLinkOpener>(LMS_LINK_OPENERS)
  const { display, setDisplay } = useLmsDisplay()

  const go = (href: string) => void navigate({ href })
  // Platform links open what Semestra has (M09 §4.3): another assignment here, a course file in
  // its preview (another file through the file proxy, in a new tab), an announcement on the
  // course's announcements page, the rest where a platform's plugin shows it. What nothing takes goes to the platform in a new tab.
  const openLink = (link: InternalLink) => {
    if (link.kind === 'assignment' || link.kind === 'quiz') {
      open(courseId, link.kind === 'quiz' ? `${PRACTICE}${link.ref}` : link.ref)
      return true
    }
    const found = detail?.targets?.find((t) => t.kind === link.kind && t.ref === link.ref)?.target
    if (found?.kind === 'file' && programId) {
      go(filePath(programId, { ...found, folder_id: found.folder_id ?? null }))
      return true
    }
    if (link.kind === 'file') {
      window.open(fileContentUrl(courseId, link.ref), '_blank', 'noopener,noreferrer')
      return true
    }
    if (link.kind === 'announcement' && programId) {
      go(announcementPath({ kind: 'course', programId, courseId }, courseId, link.ref))
      return true
    }
    for (const opener of openers) {
      const path = programId ? opener.path(link, { programId, courseId }) : null
      if (path) {
        go(path)
        return true
      }
    }
    return false
  }
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
