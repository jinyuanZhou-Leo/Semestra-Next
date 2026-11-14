import type { ImportSession, SessionTarget } from '@semestra/api-client'
import { importsSessionListOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import type { ImportRequest } from './types'

/**
 * Imports the user can still go back to (reading, read and waiting for review, or failed and not
 * seen yet), straight from the server: every entry point, the status line and the dialog derive their state from this one
 * list, so closing a dialog or leaving a page never loses an import (M08 §6.3).
 */
export function unfinishedImportsOptions(programId: string) {
  return importsSessionListOptions({
    path: { program_id: programId },
    query: { unfinished: true, limit: 100 },
  })
}

export function useUnfinishedImports(programId: string | undefined) {
  return useQuery({ ...unfinishedImportsOptions(programId ?? ''), enabled: Boolean(programId) })
}

/** What an entry point starts: the source, its target and the options that tell imports apart. */
export type ImportKey = {
  source: ImportSession['source_kind']
  target: Partial<SessionTarget> & Pick<SessionTarget, 'kind'>
  /** `course_info`: the course settings' "Read from a file", not the gradebook's syllabus. */
  only?: string | null
  /** The LMS's own kind of import (`courses`, `assignments`, `syllabus`), null for the rest. */
  lms?: string | null
}

function lmsKind(session: ImportSession): string | null {
  const lms = session.source_meta.lms as { kind?: string } | undefined
  return lms?.kind ?? null
}

/** Still open on the server: what `imports.session.list?unfinished=true` returns. */
export function isUnfinished(session: Pick<ImportSession, 'status'>): boolean {
  return ['extracting', 'waiting_files', 'ready', 'failed'].includes(session.status)
}

const TERM_FIELDS = ['term_id', 'start_date', 'end_date'] as const

export function matchesKey(session: ImportSession, key: ImportKey): boolean {
  const { target } = key
  const same = (field: keyof SessionTarget) =>
    (session.target[field] ?? null) === (target[field] ?? null)
  return (
    session.source_kind === key.source &&
    (session.source_meta.only ?? null) === (key.only ?? null) &&
    lmsKind(session) === (key.lms ?? null) &&
    session.target.kind === target.kind &&
    (target.course_id === undefined || same('course_id')) &&
    // A term wizard's import belongs to the term being made: another term (other dates) never
    // picks it up, so every part of the term's identity has to agree, absent ones too.
    (target.kind === 'term_wizard'
      ? TERM_FIELDS.every(same)
      : target.term_id === undefined || same('term_id'))
  )
}

/** The term a wizard import is for, as its key's target. */
export function wizardTarget(context: {
  termId?: string
  startDate?: string
  endDate?: string
}): ImportKey['target'] {
  return {
    kind: 'term_wizard',
    term_id: context.termId ?? null,
    start_date: context.startDate ?? null,
    end_date: context.endDate ?? null,
  }
}

/** The unfinished import an entry point would start, if one is waiting. */
export function useUnfinishedImport(
  programId: string | undefined,
  key: ImportKey | null,
): ImportSession | undefined {
  const list = useUnfinishedImports(programId).data?.items ?? []
  return key ? list.find((session) => matchesKey(session, key)) : undefined
}

/** What a file or text import's request starts, as a key. */
export function requestKey(request: ImportRequest): ImportKey | null {
  if (request.source === 'session' || request.source === 'picker') return null
  return {
    source: request.source,
    target: request.target,
    only: request.sourceMeta?.only ?? null,
  }
}

/** Opens a waiting import where it stands: the term wizard's take the courses back to it. */
export function sessionRequest(
  session: ImportSession,
): Extract<ImportRequest, { source: 'session' }> {
  return {
    programId: session.program_id,
    mode: session.target.kind === 'term_wizard' ? 'wizard' : 'direct',
    source: 'session',
    sessionId: session.id,
  }
}
