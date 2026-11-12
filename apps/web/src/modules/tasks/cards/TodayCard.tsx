import { CardSkeleton } from '@/app/board/CardSkeleton'
import type { CardProps } from '@/app/extensions'
import { useCourses } from '@/modules/academics/queries'
import { m } from '@/paraglide/messages'
import { useTaskActions } from '../actions'
import { CompactTasks } from '../components/CompactTasks'
import { NewTaskRow } from '../components/NewTaskRow'
import { closeNewTask, newTaskPlace, useNewTaskOpen } from '../new-task'
import { useProgramTimezone, useProgramToday, useTaskSettings, useTodayTasks } from '../queries'

/** Tasks due today and overdue ones; the header's add button adds one due today (M05 §5.3). */
export default function TodayCard({ scope, instanceId }: CardProps) {
  const termId = scope.kind === 'term' ? scope.termId : undefined
  const tasks = useTodayTasks(scope.programId, termId).data?.items
  const { actions } = useTaskActions()
  const timezone = useProgramTimezone(scope.programId)
  const today = useProgramToday(scope.programId)
  const settings = useTaskSettings(scope.programId)
  const openKey = useNewTaskOpen(instanceId)
  const courses = useCourses(scope.programId, termId, { enabled: openKey !== null }).data?.items
  if (!tasks) return <CardSkeleton />
  return (
    <div className="flex h-full scroll-fade flex-col overflow-y-auto">
      <CompactTasks
        programId={scope.programId}
        tasks={tasks}
        actions={actions}
        emptyTitle={m.tasks_today_empty()}
        newRow={
          openKey === null ? null : (
            <NewTaskRow
              compact
              openKey={openKey}
              onClose={() => closeNewTask(instanceId)}
              place={newTaskPlace(
                { kind: 'smart', view: 'today' },
                { termId, today, priority: settings.default_priority },
              )}
              courses={courses ?? []}
              today={today}
              timezone={timezone}
              smartParsing={settings.smart_parsing}
              onAdd={(body) => actions.create(scope.programId, body)}
            />
          )
        }
      />
    </div>
  )
}
