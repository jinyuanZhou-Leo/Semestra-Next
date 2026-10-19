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

/** The "Terms & courses" page; `term` pre-selects a term (and filters the course table). */
export function termsAndCoursesPath(
  programId: string,
  opts: { tab?: 'terms' | 'courses'; term?: string } = {},
) {
  const query = new URLSearchParams()
  if (opts.tab) query.set('tab', opts.tab)
  if (opts.term) query.set('term', opts.term)
  const search = query.toString()
  return `/p/${programId}/academics${search ? `?${search}` : ''}`
}

export const newTermPath = (programId: string) => `/p/${programId}/terms/new`
