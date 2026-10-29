import type { Task } from '@semestra/api-client'
import { useState } from 'react'
import { MobileList, MobileSection } from '@/app/mobile/MobilePage'
import { useCourses } from '@/modules/academics/queries'
import { plusDays } from '@/modules/schedule/time'
import { m } from '@/paraglide/messages'
import { useTaskActions } from '../actions'
import { useProgramToday, useTaskLists } from '../queries'
import { TaskItem } from './TaskItem'
import { TaskSheet } from './TaskSheet'

export type TaskGroup = { id: string; title: string; tone?: 'destructive'; tasks: Task[] }

/** Tasks by when they are due: overdue, today, tomorrow, the next 7 days, later, no date. */
export function groupByDue(tasks: readonly Task[], today: string): TaskGroup[] {
  const tomorrow = plusDays(today, 1)
  const week = plusDays(today, 7)
  const groups: TaskGroup[] = [
    { id: 'overdue', title: m.mobile_tasks_overdue(), tone: 'destructive', tasks: [] },
    { id: 'today', title: m.tasks_due_today(), tasks: [] },
    { id: 'tomorrow', title: m.tasks_due_tomorrow(), tasks: [] },
    { id: 'week', title: m.mobile_tasks_next_week(), tasks: [] },
    { id: 'later', title: m.mobile_tasks_later(), tasks: [] },
    { id: 'none', title: m.tasks_due_none(), tasks: [] },
  ]
  const [overdue, due, next, soon, later, none] = groups
  for (const task of tasks) {
    const date = task.due_date
    const group = !date
      ? none
      : task.overdue || date < today
        ? overdue
        : date === today
          ? due
          : date === tomorrow
            ? next
            : date <= week
              ? soon
              : later
    group!.tasks.push(task)
  }
  return groups.filter((group) => group.tasks.length > 0)
}

/**
 * Groups of tasks as phone rows (M17), with the details drawer a row opens. The drawer keeps the
 * last task while it slides away.
 */
export function TaskSections({ programId, groups }: { programId: string; groups: TaskGroup[] }) {
  const today = useProgramToday(programId)
  const courses = useCourses(programId).data?.items ?? []
  const lists = useTaskLists(programId).data?.items ?? []
  const { actions } = useTaskActions()
  const [sheet, setSheet] = useState<{ task: Task; open: boolean } | null>(null)
  return (
    <>
      {groups.map((group) => (
        <MobileSection key={group.id} title={group.title} tone={group.tone}>
          <MobileList label={group.title}>
            {group.tasks.map((task) => (
              <TaskItem
                key={task.id}
                task={task}
                course={courses.find((course) => course.id === task.course_id)}
                today={today}
                actions={actions}
                onOpen={(opened) => setSheet({ task: opened, open: true })}
              />
            ))}
          </MobileList>
        </MobileSection>
      ))}
      {sheet ? (
        <TaskSheet
          key={sheet.task.id}
          task={sheet.task}
          courses={courses}
          lists={lists}
          actions={actions}
          open={sheet.open}
          onClose={() => setSheet({ ...sheet, open: false })}
        />
      ) : null}
    </>
  )
}
