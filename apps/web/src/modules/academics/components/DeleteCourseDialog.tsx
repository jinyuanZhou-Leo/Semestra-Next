import type { Course } from '@semestra/api-client'
import { academicsCourseDeleteMutation } from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { courseLabel } from '../color'
import { coursePath, programPath } from '../paths'
import { invalidateAcademics } from '../queries'

export function DeleteCourseDialog({
  course,
  open,
  onOpenChange,
}: {
  course: Pick<Course, 'id' | 'program_id' | 'alias' | 'code' | 'title'>
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const router = useRouter()
  const remove = useMutation({
    ...academicsCourseDeleteMutation(),
    onError: toastError,
    onSuccess: async () => {
      onOpenChange(false)
      const here = router.state.location.pathname
      const href = coursePath(course.program_id, course.id)
      if (here === href || here.startsWith(`${href}/`)) {
        router.history.push(programPath(course.program_id))
      }
      await invalidateAcademics(queryClient)
    },
  })
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={m.academics_course_delete_title({ name: courseLabel(course) })}
      description={`${m.academics_course_delete_description()} ${m.academics_cannot_undo()}`}
      confirmLabel={m.academics_course_delete()}
      pending={remove.isPending}
      onConfirm={() => remove.mutate({ path: { course_id: course.id } })}
    />
  )
}
