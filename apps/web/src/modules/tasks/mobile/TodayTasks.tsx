import { Link } from '@tanstack/react-router'
import { CircleCheck } from 'lucide-react'
import { MobileSection } from '@/app/mobile/MobilePage'
import { plusDays } from '@/modules/schedule/time'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { useProgramToday, useTasks, useTodayTasks } from '../queries'
import { TaskSections, groupByDue } from './TaskSections'

const SCHEDULED = { kind: 'smart', view: 'scheduled' } as const

/**
 * The tasks part of the phone's Today (M17): overdue and due today, then the next 7 days, each
 * checked off in place; a link to the whole list.
 */
export function TodayTasks({ programId }: { programId: string }) {
  const today = useProgramToday(programId)
  const due = useTodayTasks(programId).data?.items
  const scheduled = useTasks({ programId }, SCHEDULED, {
    sort: 'due',
    completed: 'hide',
    limit: 50,
  }).data?.items
  if (!due || !scheduled) return null
  const week = plusDays(today, 7)
  const coming = scheduled.filter((t) => t.due_date && t.due_date > today && t.due_date <= week)
  const groups = groupByDue([...due, ...coming], today)
  return (
    <>
      {groups.length === 0 ? (
        <MobileSection title={m.tasks_name()}>
          <Empty className="rounded-2xl border border-solid border-border p-6">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CircleCheck aria-hidden />
              </EmptyMedia>
              <EmptyTitle>{m.mobile_today_no_tasks()}</EmptyTitle>
            </EmptyHeader>
          </Empty>
        </MobileSection>
      ) : (
        <TaskSections programId={programId} groups={groups} />
      )}
      <div className="px-4 pt-3">
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          nativeButton={false}
          render={<Link to="/p/$programId/$page" params={{ programId, page: 'tasks' }} />}
        >
          {m.mobile_today_all_tasks()}
        </Button>
      </div>
    </>
  )
}
