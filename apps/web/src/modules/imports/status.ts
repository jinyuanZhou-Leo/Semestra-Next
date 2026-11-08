import type { ImportSession } from '@semestra/api-client'

/** Still being read (or waiting for course files to be processed first): nothing to review yet. */
export function isReading(session: Pick<ImportSession, 'status'> | undefined): boolean {
  return session?.status === 'extracting' || session?.status === 'waiting_files'
}
