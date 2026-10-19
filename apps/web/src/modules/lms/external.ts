import type { ExternalCourse } from '@semestra/api-client'
import { m } from '@/paraglide/messages'

export type TermGroup = { term: string; courses: ExternalCourse[] }

/** External courses by the platform's term, current terms first, then newest (M09 §7.1). */
export function groupByTerm(courses: readonly ExternalCourse[]): TermGroup[] {
  const groups = new Map<string, ExternalCourse[]>()
  for (const course of courses) {
    const term = course.term || m.lms_term_none()
    groups.set(term, [...(groups.get(term) ?? []), course])
  }
  const newest = (list: ExternalCourse[]) =>
    Math.max(0, ...list.map((c) => Date.parse(c.start_at ?? '') || 0))
  return [...groups]
    .map(([term, list]) => ({ term, courses: list }))
    .toSorted(
      (a, b) =>
        Number(b.courses.some((c) => c.is_current)) - Number(a.courses.some((c) => c.is_current)) ||
        newest(b.courses) - newest(a.courses),
    )
}

export function externalLabel(course: { code?: string | null; name: string }): string {
  return course.code && !course.name.startsWith(course.code)
    ? `${course.code} · ${course.name}`
    : course.name
}
