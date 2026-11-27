import type { ExternalCourse } from '@semestra/api-client'

const normalize = (code: string | null | undefined) =>
  (code ?? '').replace(/\s+/g, '').toUpperCase()

/**
 * Whether a platform course is a match for a course by its code: the platform's code starts with
 * the course's (platforms add a section or a year, "ECE110H1 F LEC0101"). Codes under three
 * characters match too much to suggest anything.
 */
export function codeMatches(courseCode: string | null | undefined, external: ExternalCourse) {
  const code = normalize(courseCode)
  return code.length >= 3 && normalize(external.code).startsWith(code)
}

/** Current terms first, then the newest. */
const newestFirst = (a: ExternalCourse, b: ExternalCourse) =>
  Number(b.is_current ?? false) - Number(a.is_current ?? false) ||
  (Date.parse(b.start_at ?? '') || 0) - (Date.parse(a.start_at ?? '') || 0)

/**
 * The platform course suggested for each unlinked course (M09 §7.1): one whose code matches and
 * that no course links to, current terms and then the newest first. Each platform course is
 * suggested once, to the first course (by code) it matches, so linking them all never asks two
 * courses for the same one.
 */
export function suggestLinks(
  courses: readonly { id: string; code: string | null }[],
  externals: readonly ExternalCourse[],
): Map<string, ExternalCourse> {
  const free = externals.filter((e) => !e.linked_course_id).toSorted(newestFirst)
  const taken = new Set<string>()
  const suggested = new Map<string, ExternalCourse>()
  for (const course of courses.toSorted((a, b) =>
    normalize(a.code).localeCompare(normalize(b.code)),
  )) {
    const match = free.find((e) => !taken.has(e.external_id) && codeMatches(course.code, e))
    if (!match) continue
    taken.add(match.external_id)
    suggested.set(course.id, match)
  }
  return suggested
}
