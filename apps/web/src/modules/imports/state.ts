import type { ImportSession } from '@semestra/api-client'
import { useJob } from '@/hooks/use-job'
import { m } from '@/paraglide/messages'
import { isReading } from './status'

/** Uploading takes the first fifth of a file import's bar; reading the files fills the rest. */
export const UPLOAD_SHARE = 20

/**
 * How far an import is, from its reading job's progress: the same number in the dialog, on the
 * entry point and in the status line (an import with uploads had them done before it read).
 */
export function readingProgress(
  session: Pick<ImportSession, 'source_refs'>,
  jobProgress: number,
): number {
  if (!session.source_refs.some((ref) => ref.upload_id)) return jobProgress
  return UPLOAD_SHARE + ((100 - UPLOAD_SHARE) * jobProgress) / 100
}

/** Items an import found, for "To review · 12". */
export function importItemCount(session: Pick<ImportSession, 'summary'>): number {
  return Object.values(session.summary.counts ?? {}).reduce((sum, n) => sum + n, 0)
}

/**
 * Where an unfinished import stands, in a few words for its entry point and the status line:
 * "Reading · 46%" (or what it waits for), "To review · 12". Null for anything else.
 */
export function useImportState(
  session: Pick<ImportSession, 'status' | 'job_id' | 'summary' | 'source_refs'> | undefined,
): { text: string; reading: boolean; progress: number | null } | null {
  const reading = isReading(session)
  const job = useJob(reading ? session?.job_id : null)
  if (!session) return null
  if (session.status === 'waiting_files') {
    return { text: m.imports_waiting_files(), reading, progress: null }
  }
  if (reading) {
    const progress = readingProgress(session, job.progress)
    const text = job.waiting
      ? job.stageLabel
      : m.imports_state_reading({ percent: Math.round(progress) })
    return { text, reading, progress }
  }
  if (session.status === 'ready') {
    return {
      text: m.imports_state_ready({ count: importItemCount(session) }),
      reading,
      progress: null,
    }
  }
  return null
}
