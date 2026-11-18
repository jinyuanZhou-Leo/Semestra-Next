import { client } from '@semestra/api-client'

/**
 * Where the API streams a file of a linked course from the platform (M09 `lmsFileContent`): file
 * previews, downloads, and images in LMS HTML, which need a platform session at their own address.
 */
export function fileContentUrl(courseId: string, fileId: string, download = false): string {
  const base = client.getConfig().baseUrl ?? ''
  const path = `/courses/${encodeURIComponent(courseId)}/lms/files/${encodeURIComponent(fileId)}/content`
  return `${base}${path}${download ? '?download=true' : ''}`
}
