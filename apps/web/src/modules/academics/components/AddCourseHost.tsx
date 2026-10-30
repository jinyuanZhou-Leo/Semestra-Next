import { type ComponentProps, Suspense } from 'react'
import { preloadable } from '@/app/extensions'
import { closeAddCourses, useOpenAddCourses } from '../add-courses'
import type { AddCourseDialog as Dialog } from './AddCourseDialog'

// The rows table loads the first time someone enters courses by hand.
const AddCourseDialog = preloadable<ComponentProps<typeof Dialog>>(() =>
  import('./AddCourseDialog').then((mod) => ({ default: mod.AddCourseDialog })),
)

/** Renders "Add course → Enter manually" wherever it was opened from (see `add-courses.ts`). */
export function AddCourseHost() {
  const open = useOpenAddCourses()
  if (!open) return null
  return (
    <Suspense fallback={null}>
      <AddCourseDialog
        key={open.id}
        programId={open.programId}
        termId={open.termId}
        onClose={closeAddCourses}
      />
    </Suspense>
  )
}
