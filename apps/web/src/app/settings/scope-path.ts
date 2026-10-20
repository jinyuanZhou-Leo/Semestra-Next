import type { Course, Program, Term } from '@semestra/api-client'
import {
  academicsCourseGetOptions,
  academicsTermGetOptions,
} from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { useCurrentTerm } from '@/modules/academics/current-term'
import {
  courseTermId,
  pickProgram,
  useCourses,
  usePrograms,
  useTerms,
} from '@/modules/academics/queries'
import { usePreferences } from '../preferences'
import type { Scope, SettingsLevel } from '../extensions'
import type { SettingsTarget } from './use-settings-dialog'

/**
 * The Program, term and course along the settings dialog's level path. `courseId: null` means
 * the course was cleared on purpose (another term was picked), so the course node waits for one.
 */
export type PathIds = { programId?: string; termId?: string; courseId?: string | null }

export type SettingsPath = {
  /** The level shown: the one asked for, or the deepest one above it that has a scope. */
  level: SettingsLevel
  scope?: Scope
  program?: Program
  term?: Term
  course?: Course
  programs: readonly Program[]
  /** The terms of the Program on the path. */
  terms?: readonly Term[]
  /** The courses of the term on the path. */
  courses?: readonly Course[]
  /** The term the sidebar treats as current, marked in the term picker. */
  currentTermId?: string
  /** Still loading the Program, term or course the URL names. */
  pending: boolean
}

/**
 * Resolves the dialog's level path. The URL's `scope` names the entity of the level being edited;
 * the levels around it come from what was picked in the dialog, else from the page on screen,
 * else from the remembered Program and its current term. Old links without `scope` keep working
 * because the page supplies it.
 */
export function useSettingsPath(target: SettingsTarget, base: PathIds): SettingsPath {
  const { level, scope } = target
  const programs = usePrograms()
  const active = usePreferences().data?.active_program_id

  const courseId = (level === 'course' ? scope : undefined) ?? base.courseId ?? undefined
  const course = useQuery({
    ...academicsCourseGetOptions({ path: { course_id: courseId ?? '' } }),
    enabled: courseId !== undefined,
  })
  const urlTermId = level === 'term' ? scope : undefined
  const urlTerm = useQuery({
    ...academicsTermGetOptions({ path: { term_id: urlTermId ?? '' } }),
    enabled: urlTermId !== undefined,
  })

  // A course or term deleted while the dialog shows it answers 404; its old data must not linger.
  const courseData = course.isError ? undefined : course.data
  const urlTermData = urlTerm.isError ? undefined : urlTerm.data

  const urlProgramId =
    level === 'program'
      ? scope
      : level === 'term'
        ? urlTermData?.program_id
        : level === 'course' && scope
          ? courseData?.program_id
          : undefined
  const programList = programs.data?.items ?? []
  const programId =
    urlProgramId ?? base.programId ?? courseData?.program_id ?? pickProgram(programList, active)?.id
  const program = programList.find((p) => p.id === programId)

  const termsQuery = useTerms(programId ?? '')
  const terms = termsQuery.data?.items
  const current = useCurrentTerm(programId ?? '')
  const courseInProgram = courseData?.program_id === programId ? courseData : undefined
  const termId =
    urlTermId ??
    (base.programId === programId ? base.termId : undefined) ??
    (courseInProgram ? courseTermId(courseInProgram, terms, undefined) : undefined) ??
    current.term?.id
  // Once the term list is in, it decides: a term missing from it was deleted.
  const term = terms
    ? terms.find((t) => t.id === termId)
    : urlTermData?.id === termId
      ? urlTermData
      : undefined
  const coursesQuery = useCourses(programId ?? '', term ? term.id : undefined)
  const courses = coursesQuery.data ? coursesQuery.data.items : undefined
  // The term's course list decides too: right after a delete it no longer has the course.
  const pathCourse =
    courseInProgram &&
    term &&
    courseInProgram.term_ids.includes(term.id) &&
    (!courses || courses.some((c) => c.id === courseInProgram.id))
      ? courseInProgram
      : undefined

  // Account settings never wait for the academic path; the other levels wait for what names them.
  const pending =
    level !== 'account' &&
    ((urlTermId !== undefined && urlTerm.isPending) ||
      (courseId !== undefined && course.isPending) ||
      programs.isPending)
  const resolved = deepest(level, { program, term, course: pathCourse })
  return {
    level: resolved,
    scope: scopeAt(resolved, program, term, pathCourse),
    program,
    term,
    course: pathCourse,
    programs: programList,
    terms,
    courses,
    currentTermId: current.term?.id,
    pending,
  }
}

function deepest(
  level: SettingsLevel,
  path: { program?: Program; term?: Term; course?: Course },
): SettingsLevel {
  if (level === 'course' && path.course) return 'course'
  if ((level === 'course' || level === 'term') && path.term) return 'term'
  if (level !== 'account' && path.program) return 'program'
  return 'account'
}

function scopeAt(
  level: SettingsLevel,
  program?: Program,
  term?: Term,
  course?: Course,
): Scope | undefined {
  if (!program) return undefined
  if (level === 'program') return { kind: 'program', programId: program.id }
  if (level === 'term' && term) return { kind: 'term', programId: program.id, termId: term.id }
  if (level === 'course' && course) {
    return { kind: 'course', programId: program.id, courseId: course.id }
  }
  return undefined
}

/** The id the URL's `scope` carries for a level of the path. */
export function scopeIdAt(level: SettingsLevel, path: SettingsPath): string | undefined {
  if (level === 'program') return path.program?.id
  if (level === 'term') return path.term?.id
  if (level === 'course') return path.course?.id
  return undefined
}
