import type { ImportSessionDetail } from '@semestra/api-client'
import { useState } from 'react'

/** Sources the model reads (or Sem builds): reading them again takes time and AI usage. */
const READ_BY_AI = new Set<ImportSessionDetail['source_kind']>([
  'syllabus',
  'timetable_image',
  'text',
  'agent',
])

/** What the user can change in the review: an item's type, fields and decision. */
function fingerprint(session: ImportSessionDetail): string {
  return JSON.stringify(session.items.map((i) => [i.id, i.type, i.decision, i.data]))
}

/**
 * Whether discarding the open session throws away work worth a confirmation (M08 §6.2): a
 * reading by AI, running or done, or items the user changed here. A structured import (an ICS
 * file, assignments from the platform) is quick to start again, so it closes directly.
 */
export function useWorthKeeping(session: ImportSessionDetail | undefined): boolean {
  // The items as they first came up for review; a change from them is the user's.
  const [baseline, setBaseline] = useState<string | null>(null)
  if (!session || (session.status !== 'ready' && session.status !== 'extracting')) return false
  if (READ_BY_AI.has(session.source_kind)) return true
  if (session.status !== 'ready') return false
  const now = fingerprint(session)
  if (baseline === null) {
    setBaseline(now)
    return false
  }
  return now !== baseline
}
