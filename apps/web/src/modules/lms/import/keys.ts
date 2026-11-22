import type { ImportKey } from '@/modules/imports/unfinished'

/** The course's syllabus import (M09 `lms.syllabus.import`), whichever entry started it. */
export const syllabusImportKey = (courseId: string): ImportKey => ({
  source: 'text',
  target: { kind: 'course', course_id: courseId },
  lms: 'syllabus',
})
