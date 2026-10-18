import type { Board, BoardCard } from '@semestra/api-client'
import { layoutsCardSettingsUpdate } from '@semestra/api-client'
import { layoutsBoardGetOptions } from '@semestra/api-client/react-query'
import { type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { BoardKind, Scope } from '../extensions'

export type BoardRef = { scope_type: BoardKind; scope_id: string }

/** The backend board of a scope; the Today board belongs to the Program (M04 §5.1). */
export function boardRef(scope: Scope, board?: 'today'): BoardRef {
  if (board === 'today') return { scope_type: 'today', scope_id: scope.programId }
  switch (scope.kind) {
    case 'program':
      return { scope_type: 'program', scope_id: scope.programId }
    case 'term':
      return { scope_type: 'term', scope_id: scope.termId }
    case 'course':
      return { scope_type: 'course', scope_id: scope.courseId }
  }
}

export function boardOptions(ref: BoardRef) {
  return layoutsBoardGetOptions({ path: ref })
}

export function useBoard(ref: BoardRef) {
  return useQuery(boardOptions(ref))
}

const BOARD_QUERIES = [{ _id: 'layoutsBoardGet' }]

/** Applies `patch` to the card `instanceId` in every cached board. */
export function patchCachedCard(
  queryClient: QueryClient,
  instanceId: string,
  patch: (card: BoardCard) => BoardCard,
) {
  queryClient.setQueriesData<Board>({ queryKey: BOARD_QUERIES }, (board) =>
    board && board.cards.some((c) => c.instance_id === instanceId)
      ? {
          ...board,
          cards: board.cards.map((c) => (c.instance_id === instanceId ? patch(c) : c)),
        }
      : board,
  )
}

export type CardSettingsStatus = 'idle' | 'saving' | 'error'

/**
 * Saves a card's settings from inside the card (a counter's value, a note's text). Optimistic:
 * the board cache changes at once and is rolled back if the save fails. The backend replaces
 * the whole object, so pass every field. Debounce in the card if it saves while typing.
 */
export function useCardSettings<T extends object>(instanceId: string) {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<CardSettingsStatus>('idle')
  const [error, setError] = useState<unknown>(null)
  async function save(next: T): Promise<void> {
    let previous: Record<string, unknown> | undefined
    patchCachedCard(queryClient, instanceId, (card) => {
      previous = card.settings
      return { ...card, settings: { ...next } as Record<string, unknown> }
    })
    setStatus('saving')
    try {
      await layoutsCardSettingsUpdate({
        path: { instance_id: instanceId },
        body: { settings: next as Record<string, never> },
        throwOnError: true,
      })
      setStatus('idle')
      setError(null)
    } catch (err) {
      if (previous) {
        const restore = previous
        patchCachedCard(queryClient, instanceId, (card) => ({ ...card, settings: restore }))
      }
      setStatus('error')
      setError(err)
      throw err
    }
  }
  return { save, status, error }
}
