import type { Course } from '@semestra/api-client'
import { subjectColor } from '@/lib/subject-color'

/**
 * Display color of a course (M02 §2): its own color, else its subject's, else a palette slot.
 * The backend resolves the priority into `resolved_color`; this maps it to a CSS color.
 */
export function courseColor(course: Pick<Course, 'resolved_color'>): string {
  return subjectColor(course.resolved_color)
}

/** Navigation label: the alias, else the code, else the title. */
export function courseLabel(course: Pick<Course, 'alias' | 'code' | 'title'>): string {
  return course.alias || course.code || course.title
}
