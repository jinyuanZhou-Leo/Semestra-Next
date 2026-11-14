import type { ImportSession } from '@semestra/api-client'
import { useParams } from '@tanstack/react-router'
import { CircleAlert, ListChecks, LoaderCircle } from 'lucide-react'
import type { StatusItem } from '@/app/extensions'
import { m } from '@/paraglide/messages'
import { SOURCE_KIND_LABELS } from './labels'
import { openImport } from './launcher'
import { useImportState } from './state'
import { isReading } from './status'
import { sessionRequest, useUnfinishedImports } from './unfinished'

/** What an import is called on its line: the course settings' reading, an LMS, or its source. */
function importName(session: ImportSession): string {
  if (session.source_meta.only === 'course_info') return m.imports_course_info_title()
  if (session.source_meta.lms) return SOURCE_KIND_LABELS.lms()
  return SOURCE_KIND_LABELS[session.source_kind]()
}

/**
 * The imports' line in the status bar (M08 §6.3): the one way back to an import that is still
 * being read, waits for review or failed while the user was away, from any page. Clicking it
 * opens the import dialog where the import stands (a failure says why; closing it is seeing it).
 * Term-wizard imports have their way back in the wizard instead.
 */
export function useImportLine(): StatusItem | null {
  const { programId } = useParams({ strict: false }) as { programId?: string }
  const list = (useUnfinishedImports(programId).data?.items ?? []).filter(
    (session) => session.target.kind !== 'term_wizard',
  )
  const failed = list.filter((session) => session.status === 'failed')
  const ready = list.filter((session) => session.status === 'ready')
  const reading = list.filter((session) => isReading(session))
  // What waits for the user comes first.
  const first = failed[0] ?? ready[0] ?? reading[0]
  const state = useImportState(first)
  if (!first || !state) return null
  const onSelect = () => void openImport(sessionRequest(first))
  const label = `${importName(first)} · ${state.text}`
  if (failed.length > 0) {
    return {
      icon: CircleAlert,
      tone: 'error',
      rank: 'error',
      label: failed.length > 1 ? m.imports_line_failed({ count: failed.length }) : label,
      onSelect,
    }
  }
  if (list.length > 1) {
    return ready.length > 0
      ? {
          icon: ListChecks,
          tone: 'accent',
          rank: 'attention',
          label: m.imports_line_ready({ count: ready.length }),
          onSelect,
        }
      : {
          icon: LoaderCircle,
          spin: true,
          rank: 'running',
          label: m.imports_line_reading({ count: reading.length }),
          onSelect,
        }
  }
  return state.reading
    ? {
        icon: LoaderCircle,
        spin: true,
        rank: 'running',
        label,
        progress: state.progress ?? undefined,
        onSelect,
      }
    : { icon: ListChecks, tone: 'accent', rank: 'attention', label, onSelect }
}
