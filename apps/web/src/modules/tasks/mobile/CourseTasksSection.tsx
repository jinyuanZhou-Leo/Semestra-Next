import { useProgramToday, useTasks } from '../queries'
import { TaskSections, groupByDue } from './TaskSections'

/**
 * A course's unfinished tasks on its phone overview (M17 §4.1), grouped by when they are due and
 * checked off in place as on Today; nothing when there are none.
 */
export default function CourseTasksSection({
  programId,
  courseId,
}: {
  programId: string
  courseId: string
}) {
  const today = useProgramToday(programId)
  const tasks = useTasks(
    { programId },
    { kind: 'course', courseId },
    { sort: 'due', completed: 'hide', limit: 50 },
  ).data?.items
  if (!tasks || tasks.length === 0) return null
  return <TaskSections programId={programId} groups={groupByDue(tasks, today)} />
}
