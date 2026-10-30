import {
  academicsCourseCreateMany,
  academicsCourseSetTerms,
  type Course,
} from '@semestra/api-client'
import { type QueryClient, useQueries, useQueryClient } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import { useExtensions } from '@/app/registry'
import { toastError } from '@/lib/errors'
import { invalidateAcademics, useCourses, useTerms } from './queries'
import { TERM_WIZARD_IMPORT_SOURCES, type TermWizardImportSource } from './types'
import {
  type DraftRow,
  continuationCandidates,
  courseFields,
  filledRows,
  importedRow,
} from './wizard/draft'

/**
 * Adding courses to a term that exists (M02 §5.4), the same from every "Add course" button and
 * the command palette: type them in, continue a year-long course of the previous term, or read
 * them in with one of the term wizard's import sources.
 */

/** The import sources, with what their menu labels read loaded up front. */
export function useCourseSources(programId: string) {
  const sources = useExtensions<TermWizardImportSource>(TERM_WIZARD_IMPORT_SOURCES)
  useQueries({ queries: sources.flatMap((s) => (s.query ? [s.query(programId)] : [])) })
  return sources
}

/**
 * Hands each import source the courses created from its drafts (`courseIds` in the order of
 * `filledRows(rows)`), so it can write what belongs to them (meetings, assessments, LMS links).
 */
export async function runImportCallbacks(
  sources: readonly TermWizardImportSource[],
  rows: readonly DraftRow[],
  courseIds: readonly string[],
) {
  const filled = filledRows(rows)
  for (const source of sources) {
    if (!source.onCoursesCreated) continue
    const mapping = filled.flatMap((row, index) => {
      const courseId = courseIds[index]
      return row.sourceId === source.id && row.draft?.extras && courseId
        ? [{ draft: row.draft, courseId }]
        : []
    })
    if (mapping.length === 0) continue
    await source.onCoursesCreated(mapping).catch(toastError)
  }
}

type Open = { programId: string; termId: string; id: number }

let current: Open | null = null
let nextId = 1
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

/** Opens "Enter manually" (an app-wide overlay, `AddCourseHost`) for the term. */
export function openAddCourses(programId: string, termId: string) {
  current = { programId, termId, id: nextId++ }
  emit()
}

export function closeAddCourses() {
  current = null
  emit()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useOpenAddCourses(): Open | null {
  return useSyncExternalStore(subscribe, () => current)
}

/** Creates filled rows in the term and hands the imported ones to their sources. */
export async function createCourses(
  queryClient: QueryClient,
  {
    programId,
    termId,
    rows,
    sources,
  }: {
    programId: string
    termId: string
    rows: readonly DraftRow[]
    sources: readonly TermWizardImportSource[]
  },
) {
  const filled = filledRows(rows)
  if (filled.length === 0) return
  const { data } = await academicsCourseCreateMany({
    path: { program_id: programId },
    body: { courses: filled.map((row) => ({ ...courseFields(row), term_ids: [termId] })) },
    throwOnError: true,
  })
  await runImportCallbacks(
    sources,
    filled,
    data.items.map((c) => c.id),
  )
  await invalidateAcademics(queryClient)
}

/** What the add-course menu offers for a term, and the two actions that need no dialog. */
export function useAddCourseOptions(programId: string, termId: string) {
  const queryClient = useQueryClient()
  const terms = useTerms(programId).data?.items ?? []
  const courses = useCourses(programId).data?.items ?? []
  const sources = useCourseSources(programId)
  const term = terms.find((t) => t.id === termId)
  const candidates = term ? continuationCandidates(terms, courses, term.start_date) : []

  /** Adds the term to a year-long course of the previous term. */
  const continueCourse = async (course: Course) => {
    await academicsCourseSetTerms({
      path: { course_id: course.id },
      body: { term_ids: [...course.term_ids, termId] },
      throwOnError: true,
    })
      .then(() => invalidateAcademics(queryClient))
      .catch(toastError)
  }

  /** The source's import dialog reviews the courses; they are created when it closes. */
  const importFrom = async (source: TermWizardImportSource) => {
    await source
      .launch({ programId, startDate: term?.start_date, endDate: term?.end_date })
      .then((drafts) =>
        createCourses(queryClient, {
          programId,
          termId,
          rows: drafts.map((d) => importedRow(source.id, d)),
          sources,
        }),
      )
      .catch(toastError)
  }

  return { candidates, sources, continueCourse, importFrom }
}
