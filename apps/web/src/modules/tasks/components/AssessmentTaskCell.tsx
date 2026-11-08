import type { Assessment, Task, TaskPage } from '@semestra/api-client'
import { useQuery } from '@tanstack/react-query'
import { courseTasksOptions, TaskCheck } from './TaskCheck'

const byAssessment = (page: TaskPage): ReadonlyMap<string, Task> =>
  new Map(page.items.flatMap((t) => (t.assessment_id ? [[t.assessment_id, t] as const] : [])))

/**
 * The gradebook's to-do column (M05 §5, contributed to `grading.assessmentColumns`): the
 * assessment's to-do, checked off in place, or a dash when it has no due date (and so no to-do).
 */
export default function AssessmentTaskCell({
  assessment,
  programId,
}: {
  assessment: Assessment
  programId: string
}) {
  const { data } = useQuery({
    ...courseTasksOptions(programId, assessment.course_id),
    select: byAssessment,
  })
  if (!data) return null
  const task = data.get(assessment.id)
  if (!task) return <span className="text-muted-foreground">—</span>
  return <TaskCheck task={task} courseId={assessment.course_id} />
}
