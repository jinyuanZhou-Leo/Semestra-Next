import { client } from '@semestra/api-client'
import { lmsCourseLinkGetOptions, lmsCourseLinkListOptions } from '@semestra/api-client/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'

export function openExternal(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer')
}

/** The course's LMS link: shared with the course info card and the gradebook banner (M09). */
export function courseLinkOptions(courseId: string) {
  return { ...lmsCourseLinkGetOptions({ path: { course_id: courseId } }), staleTime: 60_000 }
}

/** Every course link of a Program: one request tells which courses have a Canvas page. */
export function programLinksOptions(programId: string) {
  return { ...lmsCourseLinkListOptions({ path: { program_id: programId } }), staleTime: 60_000 }
}

/**
 * "Open in Canvas" from the command palette: the linked course's home on the platform. The link
 * is fetched when needed.
 */
export async function openLinkedCourse(queryClient: QueryClient, courseId: string) {
  try {
    const data = await queryClient.fetchQuery(courseLinkOptions(courseId))
    const url = data.link?.provider === 'canvas' ? data.link.web_url : null
    if (url) openExternal(url)
    else toast.error(m.lms_course_not_linked())
  } catch (error) {
    toastError(error)
  }
}

/** Where the API streams an LMS file (M09 `lmsFileContent`), for previews and downloads. */
export function fileContentUrl(courseId: string, fileId: string, download = false): string {
  const base = client.getConfig().baseUrl ?? ''
  const path = `/courses/${encodeURIComponent(courseId)}/lms/files/${encodeURIComponent(fileId)}/content`
  return `${base}${path}${download ? '?download=true' : ''}`
}
