import type { LinkTarget } from '@semestra/api-client'
import { useNavigate } from '@tanstack/react-router'
import { useExtensions } from '@/app/registry'
import type { InternalLink } from '@/components/SafeHtml'
import { filePath } from '@/modules/files/location'
import { announcementPath } from '../announcements'
import { quizRef } from '../assignment/queries'
import { useAssignmentDetails } from '../assignment/target'
import { LMS_LINK_OPENERS, type LmsLinkOpener } from '../types'
import { fileContentUrl } from './file-url'

/**
 * Where a platform link in the platform's HTML (an announcement, an assignment's description)
 * opens, the same wherever the HTML is shown (M09 §4.3, §7.3): an assignment or a quiz in its
 * details; a file that is in the course's files in their preview, another file through the file
 * proxy in a new tab; an announcement on the course's announcements page; a page or a module
 * where a platform's plugin shows it (`lms.linkOpeners`). It answers false for what nothing
 * takes: that link goes to the platform in a new tab.
 *
 * `pages: false` is for where the app has none of those pages (a phone, M17): only the details
 * and the file proxy open there, the rest goes to the platform.
 */
export function useLmsLinkOpener({
  programId,
  courseId,
  targets,
  pages = true,
  onAnnouncement,
}: {
  programId: string
  courseId: string
  /** What the HTML's links to course files are in the app (`targets` of the read). */
  targets: readonly LinkTarget[] | undefined
  pages?: boolean
  /** On the announcements page itself: opens the announcement there. */
  onAnnouncement?: (ref: string) => void
}): (link: InternalLink) => boolean {
  const navigate = useNavigate()
  const details = useAssignmentDetails()
  const openers = useExtensions<LmsLinkOpener>(LMS_LINK_OPENERS)
  const go = (href: string) => void navigate({ href })
  return (link) => {
    if (link.kind === 'assignment' || link.kind === 'quiz') {
      details.open(courseId, link.kind === 'quiz' ? quizRef(link.ref) : link.ref)
      return true
    }
    if (link.kind === 'file') {
      const found = targets?.find((t) => t.kind === 'file' && t.ref === link.ref)?.target
      if (pages && programId && found?.kind === 'file') {
        go(filePath(programId, { ...found, folder_id: found.folder_id ?? null }))
      } else {
        window.open(fileContentUrl(courseId, link.ref), '_blank', 'noopener,noreferrer')
      }
      return true
    }
    if (!pages || !programId) return false
    if (link.kind === 'announcement') {
      if (onAnnouncement) onAnnouncement(link.ref)
      else go(announcementPath({ kind: 'course', programId, courseId }, courseId, link.ref))
      return true
    }
    for (const opener of openers) {
      const path = opener.path(link, { programId, courseId })
      if (path) {
        go(path)
        return true
      }
    }
    return false
  }
}
