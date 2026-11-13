import type { Completion, Module, ModuleItem } from '@semestra/api-client'
import { lmsModuleItemListOptions, lmsModuleListOptions } from '@semestra/api-client/react-query'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Circle,
  CircleAlert,
  CircleCheck,
  ClipboardList,
  ExternalLink,
  FileText,
  Layers,
  Link as LinkIcon,
  Lock,
  ListChecks,
  MessagesSquare,
  Paperclip,
  Puzzle,
} from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useDialogTarget } from '@/lib/dialog-target'
import { formatDate, formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/ui/alert-dialog'
import { Button } from '@/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/ui/collapsible'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { Progress } from '@/ui/progress'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { CanvasBoundary, ListSkeleton } from '../CanvasBoundary'
import { useCanvasPage } from '../context'
import { IconAction, ViewHeader } from './common'
import { refLocation } from '../navigation'
import { openExternal } from '../open-in-canvas'
import { FileActions } from './FilePreview'
import { useScrollIntoView } from './scroll'

/**
 * Modules of the course, with their items when the platform sends them along; otherwise a
 * module's items load when it is opened (M16 §4).
 */
export function ModulesView({ selected }: { selected?: string }) {
  const { title, courseId } = useCanvasPage()
  const confirmUrl = useDialogTarget<string>()
  const list = useQuery({
    ...lmsModuleListOptions({ path: { course_id: courseId } }),
    placeholderData: keepPreviousData,
  })
  // Which modules are open; until the user opens or closes one, the one being worked through
  // (and the one a link pointed at) are.
  const [opened, setOpened] = useState<ReadonlySet<string> | null>(null)
  const modules = (list.data?.items ?? []).toSorted((a, b) => (a.position ?? 0) - (b.position ?? 0))
  const open =
    opened ??
    new Set(
      modules
        .filter((mod) => mod.external_id === selected || mod.state === 'started')
        .map((mod) => mod.external_id),
    )
  const allOpen = modules.length > 0 && modules.every((mod) => open.has(mod.external_id))
  const toggle = (id: string, next: boolean) => {
    const set = new Set(open)
    if (next) set.add(id)
    else set.delete(id)
    setOpened(set)
  }
  return (
    <div className="flex flex-1 flex-col gap-4">
      <ViewHeader
        title={title}
        tools={
          modules.length > 1 ? (
            <IconAction
              label={allOpen ? m.canvas_tab_modules_collapse_all() : m.canvas_tab_modules_expand_all()}
              onClick={() =>
                setOpened(new Set(allOpen ? [] : modules.map((mod) => mod.external_id)))
              }
            >
              {allOpen ? <ChevronsDownUp aria-hidden /> : <ChevronsUpDown aria-hidden />}
            </IconAction>
          ) : null
        }
      />
      <CanvasBoundary
        query={list}
        isEmpty={(data) => data.items.length === 0}
        empty={
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Layers aria-hidden />
              </EmptyMedia>
              <EmptyTitle>{m.canvas_tab_modules_empty()}</EmptyTitle>
            </EmptyHeader>
          </Empty>
        }
      >
        {(data) => {
          const names = new Map(data.items.map((mod) => [mod.external_id, mod.name]))
          return (
            <div className="divide-y overflow-hidden rounded-2xl border">
              {modules.map((module) => (
                <ModuleSection
                  key={module.external_id}
                  module={module}
                  names={names}
                  focused={selected === module.external_id}
                  open={open.has(module.external_id)}
                  onOpenChange={(next) => toggle(module.external_id, next)}
                  onExternal={confirmUrl.show}
                />
              ))}
            </div>
          )
        }}
      </CanvasBoundary>
      <AlertDialog {...confirmUrl.props}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{m.canvas_tab_external_confirm_title()}</AlertDialogTitle>
            <AlertDialogDescription className="break-all">{confirmUrl.target}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{m.common_cancel()}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmUrl.target) openExternal(confirmUrl.target)
                confirmUrl.close()
              }}
            >
              {m.canvas_tab_external_confirm_open()}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/**
 * Where the user stands in a module, at the end of its header: when it unlocks, a check once
 * it is done, "2/5" while items with requirements are left, else how many items it has.
 */
function ModuleStatus({ module }: { module: Module }) {
  if (module.state === 'locked') {
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
        <Lock aria-hidden className="size-3.5" />
        {module.unlock_at
          ? m.canvas_tab_unlocks_at({ time: formatDate(module.unlock_at, { short: true }) })
          : m.canvas_tab_module_locked()}
      </span>
    )
  }
  const required = (module.items ?? []).filter((i) => i.completion)
  const done = required.filter((i) => i.completion?.completed).length
  if (module.state === 'completed' || (required.length > 0 && done === required.length)) {
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
        <CircleCheck aria-hidden className="size-4 text-primary" />
        {m.canvas_tab_module_completed()}
      </span>
    )
  }
  if (required.length > 0) {
    return (
      <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground tabular-nums">
        <Progress
          value={(done / required.length) * 100}
          aria-label={m.canvas_tab_module_progress({ done, total: required.length })}
          className="w-16 *:data-[slot=progress-track]:h-1.5"
        />
        {m.canvas_tab_module_progress({ done, total: required.length })}
      </span>
    )
  }
  return (
    <span className="shrink-0 text-xs text-muted-foreground">
      {m.canvas_tab_module_items({ count: module.item_count ?? module.items?.length ?? 0 })}
    </span>
  )
}

function ModuleSection({
  module,
  names,
  focused,
  open,
  onOpenChange,
  onExternal,
}: {
  module: Module
  names: ReadonlyMap<string, string>
  focused: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onExternal: (url: string) => void
}) {
  const ref = useScrollIntoView<HTMLDivElement>(focused ? module.external_id : undefined)
  const prerequisites = (module.prerequisite_module_ids ?? [])
    .map((id) => names.get(id))
    .filter((name): name is string => Boolean(name))
  const notes = [
    prerequisites.length > 0
      ? m.canvas_tab_module_prerequisites({ names: prerequisites.join(', ') })
      : null,
    module.require_sequential_progress ? m.canvas_tab_module_sequential() : null,
  ].filter(Boolean)
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <div ref={ref}>
        <CollapsibleTrigger
          render={
            // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- the children label it
            <button
              type="button"
              className="group/module flex w-full items-center gap-3 px-4 py-3 text-left outline-none hover:bg-muted/50 focus-visible:bg-muted/50"
            />
          }
        >
          <ChevronRight
            aria-hidden
            className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[panel-open]/module:rotate-90 motion-reduce:transition-none"
          />
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-sm font-medium',
              module.state === 'locked' && 'text-muted-foreground',
            )}
          >
            {module.name}
          </span>
          <ModuleStatus module={module} />
        </CollapsibleTrigger>
        <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-out data-[ending-style]:h-0 data-[starting-style]:h-0 motion-reduce:transition-none">
          <div className="space-y-1 px-2 pb-2">
            {notes.length > 0 ? (
              <p className="px-9 pb-1 text-xs text-muted-foreground">{notes.join(' · ')}</p>
            ) : null}
            {module.items ? (
              <ItemList items={module.items} onExternal={onExternal} />
            ) : (
              <ModuleItems moduleId={module.external_id} onExternal={onExternal} />
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}

const ICONS = {
  subheader: FileText,
  page: FileText,
  assignment: ClipboardList,
  quiz: ListChecks,
  file: Paperclip,
  discussion: MessagesSquare,
  external_url: LinkIcon,
  external_tool: Puzzle,
  unknown: ExternalLink,
} as const

function ModuleItems({
  moduleId,
  onExternal,
}: {
  moduleId: string
  onExternal: (url: string) => void
}) {
  const { courseId } = useCanvasPage()
  const items = useQuery({
    ...lmsModuleItemListOptions({ path: { course_id: courseId, module_id: moduleId } }),
    placeholderData: keepPreviousData,
  })
  return (
    <CanvasBoundary
      query={items}
      skeleton={<ListSkeleton rows={3} />}
      isEmpty={(data) => data.items.length === 0}
      empty={
        <p className="px-9 py-1 text-xs text-muted-foreground">{m.canvas_tab_module_empty()}</p>
      }
    >
      {(data) => <ItemList items={data.items} onExternal={onExternal} />}
    </CanvasBoundary>
  )
}

function ItemList({
  items,
  onExternal,
}: {
  items: ModuleItem[]
  onExternal: (url: string) => void
}) {
  if (items.length === 0) {
    return <p className="px-9 py-1 text-xs text-muted-foreground">{m.canvas_tab_module_empty()}</p>
  }
  return (
    <ul>
      {items
        .toSorted((a, b) => (a.position ?? 0) - (b.position ?? 0))
        .map((item) => (
          <li key={item.external_id} style={{ paddingLeft: `${(item.indent ?? 0) * 1.5}rem` }}>
            <ModuleItemRow item={item} onExternal={onExternal} />
          </li>
        ))}
    </ul>
  )
}

/** What finishing an item takes in Canvas (`completion_requirement.type`). */
function requirementLabel(c: Completion): string {
  switch (c.type) {
    case 'must_view':
      return m.canvas_tab_requirement_view()
    case 'must_submit':
      return m.canvas_tab_requirement_submit()
    case 'must_contribute':
      return m.canvas_tab_requirement_contribute()
    case 'must_mark_done':
      return m.canvas_tab_requirement_mark_done()
    case 'min_score':
      return m.canvas_tab_requirement_min_score({ score: c.min_score ?? 0 })
    default:
      return m.canvas_tab_requirement_other()
  }
}

function LockIcon({ explanation }: { explanation?: string | null }) {
  const why = explanation || m.canvas_tab_item_locked()
  return (
    <Tooltip>
      <TooltipTrigger
        className="inline-flex shrink-0 rounded-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        aria-label={why}
      >
        <Lock aria-hidden className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{why}</TooltipContent>
    </Tooltip>
  )
}

/** The completion check at the end of a row; red when the item is past due and not done. */
function CompletionMark({ completion, overdue }: { completion: Completion; overdue: boolean }) {
  const state = completion.completed
    ? m.canvas_tab_requirement_done()
    : overdue
      ? m.canvas_tab_overdue()
      : m.canvas_tab_requirement_todo()
  return (
    <Tooltip>
      <TooltipTrigger
        className="inline-flex rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        aria-label={`${requirementLabel(completion)}: ${state}`}
      >
        {completion.completed ? (
          <CircleCheck aria-hidden className="size-4 text-primary" />
        ) : overdue ? (
          <CircleAlert aria-hidden className="size-4 text-destructive" />
        ) : (
          <Circle aria-hidden className="size-4 text-muted-foreground" />
        )}
      </TooltipTrigger>
      <TooltipContent>
        {requirementLabel(completion)}
        {' · '}
        {state}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * One item: its link (and lock) take the room; the due date and points, the file actions (shown
 * on hover and focus) and the completion check sit at the end, lined up from row to row.
 */
function ModuleItemRow({
  item,
  onExternal,
}: {
  item: ModuleItem
  onExternal: (url: string) => void
}) {
  const [now] = useState(Date.now)
  if (item.kind === 'subheader') {
    return (
      <p className="px-9 pt-3 pb-1 text-xs font-medium text-muted-foreground">{item.title}</p>
    )
  }
  const completion = item.completion
  const overdue =
    completion != null &&
    !completion.completed &&
    item.due_at != null &&
    new Date(item.due_at).getTime() < now
  const due = item.due_at
    ? m.canvas_tab_due_at({ time: formatDate(item.due_at, { short: true }) })
    : null
  const meta = [
    overdue ? m.canvas_tab_overdue() : due,
    item.points != null && item.points > 0 ? m.canvas_tab_points({ points: item.points }) : null,
  ]
    .filter(Boolean)
    .join(' · ')
  const file = item.kind === 'file' && item.target ? item.target.ref : null
  const leaves =
    !file && !(item.target && refLocation(item.target)) && (item.external_url || item.web_url)
  return (
    <div className="group/row flex min-h-9 items-center gap-2 rounded-lg pr-2 hover:bg-muted/50 has-focus-visible:bg-muted/50">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <ModuleItemLink item={item} onExternal={onExternal} />
        {item.locked ? <LockIcon explanation={item.lock_explanation} /> : null}
        {leaves ? <ExternalLink aria-hidden className="size-3.5 shrink-0 text-muted-foreground" /> : null}
      </div>
      {file ? (
        <div className="opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100 motion-reduce:transition-none">
          <FileActions fileId={file} name={item.title} />
        </div>
      ) : null}
      {meta ? (
        <span
          title={item.due_at ? formatDateTime(item.due_at) : undefined}
          className={cn(
            'hidden shrink-0 text-xs whitespace-nowrap tabular-nums sm:inline',
            overdue ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {meta}
        </span>
      ) : null}
      <span className="flex w-5 shrink-0 justify-center">
        {completion ? <CompletionMark completion={completion} overdue={overdue} /> : null}
      </span>
    </div>
  )
}

function ModuleItemLink({
  item,
  onExternal,
}: {
  item: ModuleItem
  onExternal: (url: string) => void
}) {
  const { go } = useCanvasPage()
  const Icon = ICONS[item.kind]
  const label = (
    <>
      <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 truncate">{item.title}</span>
    </>
  )
  const rowClass = 'h-auto min-h-9 min-w-0 justify-start gap-3 px-2 py-1 font-normal hover:bg-transparent'

  if (item.kind === 'file' && item.target) {
    const fileId = item.target.ref
    return <FileName fileId={fileId}>{label}</FileName>
  }
  const inApp = item.target ? refLocation(item.target) : null
  if (inApp) {
    return (
      <Button variant="ghost" size="sm" className={rowClass} onClick={() => go(inApp)}>
        {label}
      </Button>
    )
  }
  if (item.kind === 'external_url' && item.external_url) {
    const url = item.external_url
    return (
      <Button variant="ghost" size="sm" className={rowClass} onClick={() => onExternal(url)}>
        {label}
      </Button>
    )
  }
  if (item.web_url) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className={rowClass}
        nativeButton={false}
        // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- the children label it
        render={<a href={item.web_url} target="_blank" rel="noopener noreferrer" />}
      >
        {label}
      </Button>
    )
  }
  return <span className="flex min-w-0 items-center gap-3 px-2 py-1 text-sm">{label}</span>
}

/** A file's name opens its preview, like the eye button next to it. */
function FileName({ fileId, children }: { fileId: string; children: ReactNode }) {
  const { openFile } = useCanvasPage()
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-auto min-h-9 min-w-0 justify-start gap-3 px-2 py-1 font-normal hover:bg-transparent"
      onClick={() => openFile(fileId)}
    >
      {children}
    </Button>
  )
}
