import type { ComponentType } from 'react'
import type { Message } from '@/app/extensions'
import { useImportState } from './state'
import { type ImportKey, useUnfinishedImport } from './unfinished'

/**
 * The second line of an import source in an "Add" menu: where the import it would start stands
 * ("Reading · 46%", "To review · 12", "Couldn't read"), else what it brings in. Picking the source then opens
 * that import where it stands (M08 §6.3).
 */
export function importDetail<P extends { programId: string }>(
  key: (props: P) => ImportKey,
  description?: Message,
): ComponentType<P> {
  return function ImportDetail(props: P) {
    const waiting = useUnfinishedImport(props.programId, key(props))
    const state = useImportState(waiting)
    if (state) {
      const tone = state.failed ? 'text-destructive' : state.reading ? undefined : 'text-primary'
      return <span className={tone}>{state.text}</span>
    }
    return description ? description() : null
  }
}
