import { ListChecks } from 'lucide-react'
import type { PageProps } from '@/app/extensions'
import { MobilePage } from '@/app/mobile/MobilePage'
import { useUiPref } from '@/app/ui-pref'
import { m } from '@/paraglide/messages'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from '@/ui/native-select'
import { Skeleton } from '@/ui/skeleton'
import { useTaskActions } from '../actions'
import { useProgramToday, useTaskLists, useTasks } from '../queries'
import { INBOX, SMART_VIEWS, parseSelection, selectionKey } from '../types'
import { QuickAddBar } from './QuickAddBar'
import { TaskSections, groupByDue } from './TaskSections'

// The finished tasks stay on the desktop; a phone lists what is still to do.
const VIEWS = SMART_VIEWS.filter((view) => view.view !== 'completed')

/**
 * The Tasks page on a phone (M17): a smart list, Unsorted or one list, grouped by when the tasks
 * are due, with the add line at the bottom. Sorting, dragging and managing lists stay on the
 * desktop.
 */
export default function TasksMobilePage({ scope }: PageProps) {
  const { programId } = scope
  const [key, setKey] = useUiPref('tasks.phone_selection', 'all')
  const lists = useTaskLists(programId).data?.items ?? []
  const parsed = parseSelection(key)
  // A list deleted elsewhere falls back to All.
  const selection =
    parsed.kind === 'list' && lists.length > 0 && !lists.some((l) => l.id === parsed.listId)
      ? parseSelection('all')
      : parsed.kind === 'course' || (parsed.kind === 'smart' && parsed.view === 'completed')
        ? parseSelection('all')
        : parsed
  const tasks = useTasks({ programId }, selection, { sort: 'due', completed: 'hide' })
  const today = useProgramToday(programId)
  const { actions } = useTaskActions()
  const items = tasks.data?.items
  const title =
    selection.kind === 'smart'
      ? (VIEWS.find((view) => view.view === selection.view)?.title() ?? '')
      : selection.kind === 'inbox'
        ? INBOX.title()
        : (lists.find((list) => selection.kind === 'list' && list.id === selection.listId)?.name ??
          '')
  return (
    <MobilePage
      title={m.tasks_name()}
      subtitle={
        tasks.data ? `${title} · ${m.mobile_tasks_open({ count: tasks.data.total })}` : null
      }
      action={
        <NativeSelect
          size="sm"
          aria-label={m.mobile_tasks_view()}
          value={selectionKey(selection)}
          onChange={(event) => setKey(event.target.value)}
        >
          {VIEWS.map((view) => (
            <NativeSelectOption key={view.view} value={view.view}>
              {view.title()}
            </NativeSelectOption>
          ))}
          <NativeSelectOption value="inbox">{INBOX.title()}</NativeSelectOption>
          {lists.length > 0 ? (
            <NativeSelectOptGroup label={m.mobile_tasks_lists()}>
              {lists.map((list) => (
                <NativeSelectOption key={list.id} value={`list:${list.id}`}>
                  {list.name}
                </NativeSelectOption>
              ))}
            </NativeSelectOptGroup>
          ) : null}
        </NativeSelect>
      }
      footer={
        <QuickAddBar
          programId={programId}
          defaultDue={selection.kind === 'smart' && selection.view === 'today' ? today : undefined}
          onAdd={(task) =>
            actions.create(programId, {
              ...task,
              list_id: selection.kind === 'list' ? selection.listId : undefined,
              flagged:
                selection.kind === 'smart' && selection.view === 'flagged' ? true : undefined,
            })
          }
        />
      }
    >
      {!items ? (
        <div className="flex flex-col gap-2 px-4 pt-5">
          <Skeleton className="h-14 rounded-2xl" />
          <Skeleton className="h-14 rounded-2xl" />
        </div>
      ) : items.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ListChecks aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{m.tasks_empty_title()}</EmptyTitle>
            <EmptyDescription>{m.mobile_tasks_empty_description()}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <TaskSections programId={programId} groups={groupByDue(items, today)} />
      )}
    </MobilePage>
  )
}
