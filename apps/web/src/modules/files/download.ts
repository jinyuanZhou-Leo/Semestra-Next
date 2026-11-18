import { toApiError } from '@/app/api'
import { saveFile } from '@/lib/api-extras'

/** The name in a `Content-Disposition` header (`filename*` first). */
function filenameOf(header: string | null): string | null {
  const encoded = header?.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  if (encoded) {
    try {
      return decodeURIComponent(encoded)
    } catch {
      // fall through to the plain name
    }
  }
  return header?.match(/filename="([^"]+)"/i)?.[1] ?? null
}

/**
 * Downloads a zip of course files (M07 §5). It is saved only once it has arrived whole, so a
 * download the server refuses (none of the files can be read) or that breaks off halfway ends in
 * an error the caller shows, not in an archive that looks complete.
 */
export async function downloadArchive(url: string): Promise<void> {
  const response = await fetch(url, { credentials: 'include' })
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => undefined)
    throw toApiError(body, response.status)
  }
  const blob = await response.blob()
  saveFile(blob, filenameOf(response.headers.get('content-disposition')) ?? 'files.zip')
}
