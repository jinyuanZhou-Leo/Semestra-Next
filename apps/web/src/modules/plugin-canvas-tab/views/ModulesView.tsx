import type { Completion, Module, ModuleItem } from '@semestra/api-client'
import { lmsModuleItemListOptions, lmsModuleListOptions } from '@semestra/api-client/react-query'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  ChevronDown,
  ChevronRight,
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
import { formatDateTime } from '@/lib/format'
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
import { Badge } from '@/ui/badge'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { CanvasBoundary, ListSkeleton } from '../CanvasBoundary'
import { useCanvasPage } from '../context'
import { refLocation } from '../navigation'
import { openExternal } from '../open-in-canvas'
import { FileActions } from './FilePreview'
import { useScrollIntoView } from './scroll'

/**
 * Modules of the course, with their items when the platform sends them along; otherwise a
 * module's items load when it is opened (M16 §4).
 */
export function ModulesView({ selected }: { selected?: string }) {
  const { courseId } = useCanvasPage()
  const [confirmUrl, setConfirmUrl] = useState<string | null>(null)
  const list = useQuery({
    ...lmsModuleListOptions({ path: { course_id: courseId } }),
    placeholderData: keepPreviousData,
  })
  return (
    <>
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
            <div className="space-y-2">
              {data.items
                .toSorted((a, b) => (a.position ?? 0) - (b.position ?? 0))
                .map((module) => (
                  <ModuleSection
                    key={module.external_id}
                    module={module}
                    names={names}
                    focused={selected === module.external_id}
                    onExternal={setConfirmUrl}
                  />
                ))}
            </div>
          )
        }}
      </CanvasBoundary>
      <AlertDialog open={confirmUrl !== null} onOpenChange={(open) => !open && setConfirmUrl(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{m.canvas_tab_external_confirm_title()}</AlertDialogTitle>
            <AlertDialogDescription className="break-all">{confirmUrl}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{m.common_cancel()}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmUrl) openExternal(confirmUrl)
                setConfirmUrl(null)
              }}
            >
              {m.canvas_tab_external_confirm_open()}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/** The user's progress in a module, as Canvas reports it; nothing for "unlocked". */
function ModuleState({ module }: { module: Module }) {
  if (module.state === 'completed') {
    return <Badge variant="secondary">{m.canvas_tab_module_completed()}</Badge>
  }
  if (module.state === 'started') {
    return <Badge variant="outline">{m.canvas_tab_module_started()}</Badge>
  }
  if (module.state === 'locked') {
    return (
      <Badge variant="outline">
        <Lock aria-hidden />
        {m.canvas_tab_module_locked()}
      </Badge>
    )
  }
  return null
}

function ModuleSection({
  module,
  names,
  focused,
  onExternal,
}: {
  module: Module
  names: ReadonlyMap<string, string>
  focused: boolean
  onExternal: (url: string) => void
}) {
  // The module the user is working through opens by itself.
  const [open, setOpen] = useState(focused || module.state === 'started')
  const ref = useScrollIntoView<HTMLDivElement>(focused ? module.external_id : undefined)
  const meta = [
    m.canvas_tab_module_items({ count: module.item_count ?? 0 }),
    module.unlock_at ? m.canvas_tab_unlocks_at({ time: formatDateTime(module.unlock_at) }) : null,
  ]
    .filter(Boolean)
    .join(' · ')
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
    <Collapsible open={open} onOpenChange={setOpen}>
      <div ref={ref} className="rounded-2xl border">
        <CollapsibleTrigger
          render={
            // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- the children label it
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-2xl px-3 py-2.5 text-left hover:bg-muted/50"
            />
          }
        >
          {open ? (
            <ChevronDown aria-hidden className="size-4 shrink-0" />
          ) : (
            <ChevronRight aria-hidden className="size-4 shrink-0" />
          )}
          <span className="min-w-0 flex-1 truncate font-medium">{module.name}</span>
          <ModuleState module={module} />
          <span className="shrink-0 text-xs text-muted-foreground">{meta}</span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-2 border-t px-3 py-2">
            {notes.length > 0 ? (
              <p className="text-xs text-muted-foreground">{notes.join(' · ')}</p>
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
      empty={<p className="py-1 text-xs text-muted-foreground">{m.canvas_tab_module_empty()}</p>}
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
    return <p className="py-1 text-xs text-muted-foreground">{m.canvas_tab_module_empty()}</p>
  }
  return (
    <ul className="space-y-0.5">
      {items
        .toSorted((a, b) => (a.position ?? 0) - (b.position ?? 0))
        .map((item) => (
          <li key={item.external_id} style={{ paddingLeft: `${(item.indent ?? 0) * 1.25}rem` }}>
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
 * One item: its link (and lock) take the room; due date and points, the actions (file buttons
 * or the external-link mark) and the completion check sit in fixed columns at the end, so they
 * line up from row to row.
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
    return <p className="pt-2 pb-1 text-xs font-medium text-muted-foreground">{item.title}</p>
  }
  const completion = item.completion
  const overdue =
    completion != null &&
    !completion.completed &&
    item.due_at != null &&
    new Date(item.due_at).getTime() < now
  const meta = [
    item.due_at ? m.canvas_tab_due_at({ time: formatDateTime(item.due_at) }) : null,
    item.points != null ? m.canvas_tab_points({ points: item.points }) : null,
  ]
    .filter(Boolean)
    .join(' · ')
  const file = item.kind === 'file' && item.target ? item.target.ref : null
  const leaves =
    !file && !(item.target && refLocation(item.target)) && (item.external_url || item.web_url)
  return (
    <div className="flex min-h-8 items-center gap-2">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <ModuleItemLink item={item} onExternal={onExternal} />
        {item.locked ? <LockIcon explanation={item.lock_explanation} /> : null}
      </div>
      {meta ? (
        <span
          className={cn(
            'hidden shrink-0 text-xs whitespace-nowrap sm:inline',
            overdue ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {overdue ? `${m.canvas_tab_overdue()} · ${meta}` : meta}
        </span>
      ) : null}
      <div className="flex w-24 shrink-0 items-center justify-end">
        {file ? <FileActions fileId={file} name={item.title} /> : null}
        {leaves ? (
          <ExternalLink aria-hidden className="mr-2 size-3.5 text-muted-foreground" />
        ) : null}
      </div>
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
  const rowClass = 'h-auto min-h-8 min-w-0 justify-start gap-2 px-2 py-1 font-normal'

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
  return <span className="flex min-w-0 items-center gap-2 px-2 py-1 text-sm">{label}</span>
}

/** A file's name opens its preview, like the eye button next to it. */
function FileName({ fileId, children }: { fileId: string; children: ReactNode }) {
  const { openFile } = useCanvasPage()
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-auto min-h-8 min-w-0 justify-start gap-2 px-2 py-1 font-normal"
      onClick={() => openFile(fileId)}
    >
      {children}
    </Button>
  )
}
