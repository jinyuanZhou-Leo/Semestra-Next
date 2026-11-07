import { CardSkeleton } from '@/app/board/CardSkeleton'
import type { CardProps } from '@/app/extensions'
import { useCourses } from '@/modules/academics/queries'
import { m } from '@/paraglide/messages'
import { useTaskActions } from '../actions'
import { CompactTasks } from '../components/CompactTasks'
import { NewTaskRow } from '../components/NewTaskRow'
import { closeNewTask, newTaskPlace, useNewTaskOpen } from '../new-task'
import { useProgramToday, useTaskSettings, useTasks } from '../queries'
import { parseSelection } from '../types'
import type { ListCardSettings } from './schema'

/** One list or smart list of the Program, term or course the card sits on (M05 §5.3). */
export default function ListCard({ scope, instanceId, settings }: CardProps<ListCardSettings>) {
  const termId = scope.kind === 'term' ? scope.termId : undefined
  const courseId = scope.kind === 'course' ? scope.courseId : undefined
  const taskScope = { programId: scope.programId, termId, courseId }
  const selection = parseSelection(settings.source)
  const tasks = useTasks(taskScope, selection, { sort: 'manual', completed: 'hide' })
  const { actions } = useTaskActions()
  const today = useProgramToday(scope.programId)
  const taskSettings = useTaskSettings(scope.programId)
  const openKey = useNewTaskOpen(instanceId)
  const courses = useCourses(scope.programId, termId, { enabled: openKey !== null }).data?.items
  if (!tasks.data) return <CardSkeleton />
  return (
    <div className="flex h-full scroll-fade flex-col overflow-y-auto">
      <CompactTasks
        programId={scope.programId}
        tasks={tasks.data.items}
        actions={actions}
        emptyTitle={m.tasks_list_empty()}
        newRow={
          openKey === null ? null : (
            <NewTaskRow
              compact
              openKey={openKey}
              onClose={() => closeNewTask(instanceId)}
              place={newTaskPlace(selection, {
                termId,
                courseId,
                today,
                priority: taskSettings.default_priority,
              })}
              courses={courses ?? []}
              today={today}
              hideCourse={Boolean(courseId)}
              onAdd={(body) => actions.create(scope.programId, body)}
            />
          )
        }
      />
    </div>
  )
}
