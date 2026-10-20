import type { ImportItem, ImportSessionDetail } from '@semestra/api-client'
import {
  importsItemDecideManyMutation,
  importsItemUpdateMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CircleAlert, CircleCheck, SearchX } from 'lucide-react'
import { useId, useState } from 'react'
import { toastError } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { useCourses } from '@/modules/academics/queries'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Checkbox } from '@/ui/checkbox'
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { Label } from '@/ui/label'
import { Switch } from '@/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { issueText, itemDetail, itemTitle, TYPE_LABELS } from '../labels'
import { storeSession } from '../queries'
import { ItemEditor } from './ItemEditor'

const TYPE_ORDER = [
  'course',
  'course_patch',
  'category',
  'assessment',
  'assessment_patch',
  'meeting',
  'event',
  'task',
  'task_patch',
]

type Group = { key: string; label: string; items: ImportItem[] }

/** Items of an open session can be edited; after a commit only the ones that failed. */
export function isEditable(session: ImportSessionDetail, item: ImportItem): boolean {
  if (session.status === 'ready') return true
  return session.status === 'committed' && Boolean(item.result?.error_code)
}

function groupKey(item: ImportItem, targetCourse: string | null | undefined): string {
  if (item.type === 'course') return `item:${item.id}`
  if (item.type === 'course_patch') return `course:${String(item.data.course_id)}`
  const ref = item.data.course_ref
  if (typeof ref === 'string' && ref) return ref
  // Changes to existing assessments and tasks (M09) belong to the session's course.
  return item.type.endsWith('_patch') && targetCourse ? `course:${targetCourse}` : 'none'
}

/** Courses first, each with its categories, assessments, meetings and events (M08 §6.2). */
function groupItems(
  items: readonly ImportItem[],
  courseName: (id: string) => string,
  targetCourse: string | null | undefined,
): Group[] {
  const groups = new Map<string, ImportItem[]>()
  const sorted = items.toSorted(
    (a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || a.position - b.position,
  )
  for (const item of sorted) {
    const key = groupKey(item, targetCourse)
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  const byId = new Map(items.map((item) => [item.id, item]))
  return [...groups].map(([key, members]) => {
    const [kind, id = ''] = key.split(':')
    const own = kind === 'item' ? byId.get(id) : undefined
    const label =
      key === 'none'
        ? m.imports_group_other()
        : own
          ? itemTitle(own)
          : kind === 'course'
            ? courseName(id)
            : m.imports_group_other()
    return { key, label, items: members }
  })
}

function hasProblem(item: ImportItem): boolean {
  return (item.decision === 'accept' && item.issues.length > 0) || Boolean(item.result?.error_code)
}

/**
 * The review of an import session (M08 §6.2): items grouped by course with an accept switch and
 * issue marks on the left, the selected item's fields on the right. Both columns scroll on
 * their own inside a fixed height, so selecting or filtering never moves the layout.
 */
export function ImportReview({
  session,
  className,
}: {
  session: ImportSessionDetail
  className?: string
}) {
  const queryClient = useQueryClient()
  const filterId = useId()
  const courses = useCourses(session.program_id).data?.items ?? []
  const courseName = (id: string) => {
    const course = courses.find((c) => c.id === id)
    return course ? (course.code ? `${course.code} · ${course.title}` : course.title) : '…'
  }
  const [onlyProblems, setOnlyProblems] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const update = useMutation({
    ...importsItemUpdateMutation(),
    onError: toastError,
    onSuccess: (next) => storeSession(queryClient, next),
  })
  const bulk = useMutation({
    ...importsItemDecideManyMutation(),
    onError: toastError,
    onSuccess: (result) => storeSession(queryClient, result.session),
  })

  const visible = onlyProblems ? session.items.filter(hasProblem) : session.items
  const groups = groupItems(visible, courseName, session.target.course_id)
  const selected =
    session.items.find((item) => item.id === selectedId) ?? groups[0]?.items[0] ?? null
  const open = session.status === 'ready'

  const decide = (item: ImportItem, accept: boolean) =>
    update.mutate({
      path: { session_id: session.id, item_id: item.id },
      body: { decision: accept ? 'accept' : 'reject' },
    })
  const decideGroup = (group: Group, accept: boolean) =>
    bulk.mutate({
      path: { session_id: session.id },
      body: { decision: accept ? 'accept' : 'reject', item_ids: group.items.map((i) => i.id) },
    })

  return (
    <div className={cn('grid min-h-0 grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4', className)}>
      <div className="flex min-h-0 flex-col rounded-2xl border">
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Switch
            id={filterId}
            size="sm"
            checked={onlyProblems}
            onCheckedChange={setOnlyProblems}
          />
          <Label htmlFor={filterId} className="text-xs font-normal">
            {m.imports_only_problems()}
          </Label>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {groups.length === 0 ? (
            <Empty className="border-0">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <SearchX aria-hidden />
                </EmptyMedia>
                <EmptyTitle>{m.imports_no_problems()}</EmptyTitle>
              </EmptyHeader>
              <EmptyContent>
                <Button variant="outline" size="sm" onClick={() => setOnlyProblems(false)}>
                  {m.imports_clear_filter()}
                </Button>
              </EmptyContent>
            </Empty>
          ) : null}
          {groups.map((group) => {
            const accepted = group.items.filter((i) => i.decision === 'accept').length
            return (
              <section key={group.key} aria-label={group.label} className="mb-2">
                <div className="flex items-center gap-2 px-2 py-1.5">
                  <Checkbox
                    aria-label={m.imports_group_accept({ group: group.label })}
                    checked={accepted === group.items.length}
                    indeterminate={accepted > 0 && accepted < group.items.length}
                    disabled={!open || bulk.isPending}
                    onCheckedChange={(on) => decideGroup(group, on)}
                  />
                  <h4 className="truncate text-xs font-medium text-muted-foreground">
                    {group.label}
                  </h4>
                </div>
                <ul>
                  {group.items.map((item) => (
                    <ReviewRow
                      key={item.id}
                      item={item}
                      selected={item.id === selected?.id}
                      editable={isEditable(session, item) && !update.isPending}
                      onSelect={() => setSelectedId(item.id)}
                      onDecide={(accept) => decide(item, accept)}
                    />
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      </div>
      <div className="min-h-0 overflow-y-auto rounded-2xl border p-4">
        {selected ? (
          <ItemEditor key={selected.id} item={selected} editable={isEditable(session, selected)} />
        ) : null}
      </div>
    </div>
  )
}

function ReviewRow({
  item,
  selected,
  editable,
  onSelect,
  onDecide,
}: {
  item: ImportItem
  selected: boolean
  editable: boolean
  onSelect: () => void
  onDecide: (accept: boolean) => void
}) {
  const title = itemTitle(item)
  const detail = itemDetail(item)
  const failed = Boolean(item.result?.error_code)
  const done = Boolean(item.result && !failed)
  const issues = item.decision === 'accept' ? item.issues : []
  return (
    <li
      className={cn(
        'flex items-center gap-2 rounded-xl px-2 py-1.5',
        selected ? 'bg-muted' : 'hover:bg-muted/50',
      )}
    >
      <Switch
        size="sm"
        aria-label={m.imports_accept_item({ item: title })}
        checked={item.decision === 'accept'}
        disabled={!editable || done}
        onCheckedChange={onDecide}
      />
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:underline',
          item.decision !== 'accept' && 'text-muted-foreground',
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">
            <span className="text-muted-foreground">{TYPE_LABELS[item.type]()} · </span>
            {title}
          </span>
          {detail ? (
            <span className="block truncate text-xs text-muted-foreground">{detail}</span>
          ) : null}
        </span>
        {failed ? (
          <CircleAlert
            aria-label={m.imports_row_failed()}
            className="size-4 shrink-0 text-destructive"
          />
        ) : done ? (
          <CircleCheck aria-label={m.imports_row_done()} className="size-4 shrink-0 text-success" />
        ) : issues.length > 0 ? (
          <Tooltip>
            <TooltipTrigger render={<span className="shrink-0" />}>
              <CircleAlert aria-hidden className="size-4 text-destructive" />
              <span className="sr-only">{issues.map(issueText).join('; ')}</span>
            </TooltipTrigger>
            <TooltipContent>{issues.map(issueText).join('; ')}</TooltipContent>
          </Tooltip>
        ) : null}
      </button>
    </li>
  )
}
