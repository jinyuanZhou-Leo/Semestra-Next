import { Link } from '@tanstack/react-router'
import { CircleCheck } from 'lucide-react'
import { MobileSection } from '@/app/mobile/MobilePage'
import { plusDays } from '@/modules/schedule/time'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { useProgramToday, useTasksDueBetween, useTodayTasks } from '../queries'
import { TaskSections, groupByDue } from './TaskSections'

/**
 * The tasks part of the phone's Today (M17): overdue and due today, then the next 7 days, each
 * checked off in place; a link to the whole list.
 */
export function TodayTasks({ programId }: { programId: string }) {
  const today = useProgramToday(programId)
  const due = useTodayTasks(programId).data?.items
  const coming = useTasksDueBetween(programId, plusDays(today, 1), plusDays(today, 7)).data?.items
  if (!due || !coming) return null
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
