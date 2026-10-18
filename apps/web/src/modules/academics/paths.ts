import { scopePath } from '@/app/extensions'

export const programPath = (programId: string) => scopePath({ kind: 'program', programId })

export const termPath = (programId: string, termId: string, pageId?: string) =>
  scopePath({ kind: 'term', programId, termId }, pageId)

/** A course page; `fromTerm` tells the breadcrumb which term the user came from. */
export function coursePath(
  programId: string,
  courseId: string,
  pageId?: string,
  fromTerm?: string,
) {
  const base = scopePath({ kind: 'course', programId, courseId }, pageId)
  return fromTerm ? `${base}?fromTerm=${encodeURIComponent(fromTerm)}` : base
}

export const allCoursesPath = (programId: string) => `/p/${programId}/courses`

export const newTermPath = (programId: string) => `/p/${programId}/terms/new`
