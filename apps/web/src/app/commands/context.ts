import { useQueryClient } from '@tanstack/react-query'
import { useParams, useRouter } from '@tanstack/react-router'
import { useMemo } from 'react'
import type { CommandContext, Scope } from '../extensions'

type Params = { programId?: string; termId?: string; courseId?: string }

/** The scope of the page on screen, read from the URL (`/p/$programId/t/$termId/…`). */
export function scopeFromParams({ programId, termId, courseId }: Params): Scope | undefined {
  if (!programId) return undefined
  if (courseId) return { kind: 'course', programId, courseId }
  if (termId) return { kind: 'term', programId, termId }
  return { kind: 'program', programId }
}

/** What commands get to work with: the current scope and Program, navigation and the cache. */
export function useCommandContext(): CommandContext {
  const params = useParams({ strict: false }) as Params
  const router = useRouter()
  const queryClient = useQueryClient()
  const { programId, termId, courseId } = params
  return useMemo(
    () => ({
      scope: scopeFromParams({ programId, termId, courseId }),
      programId,
      navigate: (to: string) => router.history.push(to),
      queryClient,
    }),
    [router, queryClient, programId, termId, courseId],
  )
}
