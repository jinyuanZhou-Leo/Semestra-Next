import { CardSkeleton } from '@/app/board/CardSkeleton'
import type { CardProps } from '@/app/extensions'
import { m } from '@/paraglide/messages'
import { useTaskActions } from '../actions'
import { CompactTasks } from '../components/CompactTasks'
import { useTasks } from '../queries'
import { parseSelection } from '../types'
import type { ListCardSettings } from './schema'

/** One list or smart list of the Program, term or course the card sits on (M05 §5.3). */
export default function ListCard({ scope, settings }: CardProps<ListCardSettings>) {
  const taskScope = {
    programId: scope.programId,
    termId: scope.kind === 'term' ? scope.termId : undefined,
    courseId: scope.kind === 'course' ? scope.courseId : undefined,
  }
  const selection = parseSelection(settings.source)
  const tasks = useTasks(taskScope, selection, { sort: 'manual', completed: 'hide' })
  const { actions } = useTaskActions()
  if (!tasks.data) return <CardSkeleton />
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <CompactTasks
        programId={scope.programId}
        tasks={tasks.data.items}
        actions={actions}
        emptyTitle={m.tasks_list_empty()}
      />
    </div>
  )
}
