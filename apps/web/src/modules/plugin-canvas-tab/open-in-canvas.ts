import { client, lmsCourseLinkGet } from '@semestra/api-client'
import { toast } from 'sonner'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'

export function openExternal(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer')
}

/** "Open in Canvas" from the command palette: the linked course's home on the platform. */
export async function openLinkedCourse(courseId: string) {
  try {
    const { data } = await lmsCourseLinkGet({ path: { course_id: courseId }, throwOnError: true })
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
