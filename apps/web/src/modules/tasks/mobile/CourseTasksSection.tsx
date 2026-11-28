import { m } from '@/paraglide/messages'
import { useTasks } from '../queries'
import { TaskSections } from './TaskSections'

/**
 * A course's unfinished tasks on its phone overview (M17 §9), in one "Tasks" section by due date
 * (Today's groups would put a second "Today" under the classes), checked off in place; nothing when
 * there are none.
 */
export default function CourseTasksSection({
  programId,
  courseId,
}: {
  programId: string
  courseId: string
}) {
  const tasks = useTasks(
    { programId },
    { kind: 'course', courseId },
    { sort: 'due', completed: 'hide', limit: 50 },
  ).data?.items
  if (!tasks || tasks.length === 0) return null
  return (
    <TaskSections
      programId={programId}
      groups={[{ id: 'course', title: m.tasks_name(), tasks }]}
      inCourse
    />
  )
}
