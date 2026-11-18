import { fetchWithReauth, toApiError } from '@/app/api'
import { saveFile } from '@/lib/api-extras'

/**
 * Downloads a zip of course files (M07 §5). The server answers only once it has found a file it
 * can read (none: `files.download_unavailable`, before any byte), so the answer's head is asked
 * for first and the error, if any, is thrown for the caller to show; then the request is dropped
 * and the browser downloads the same address itself, with its progress, cancelling and no copy in
 * the page's memory. A download that breaks off halfway is marked failed by the browser (the
 * archive is cut short, so it does not open as a whole one).
 */
export async function downloadArchive(url: string): Promise<void> {
  const probe = new AbortController()
  const response = await fetchWithReauth(url, { signal: probe.signal })
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => undefined)
    throw toApiError(body, response.status)
  }
  probe.abort()
  // No name of its own: the browser takes the server's (the course code).
  saveFile(url, '')
}
