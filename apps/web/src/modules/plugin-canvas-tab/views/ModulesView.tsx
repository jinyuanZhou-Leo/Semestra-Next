import type { Module, ModuleItem } from '@semestra/api-client'
import { lmsModuleItemsListOptions, lmsModulesListOptions } from '@semestra/api-client/react-query'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  ChevronDown,
  ChevronRight,
  ClipboardList,
  ExternalLink,
  FileText,
  Layers,
  Link as LinkIcon,
  ListChecks,
  MessagesSquare,
  Paperclip,
  Puzzle,
} from 'lucide-react'
import { useState } from 'react'
import { formatDateTime } from '@/lib/format'
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
import { CanvasBoundary, ListSkeleton } from '../CanvasBoundary'
import { useCanvasPage } from '../context'
import { refLocation } from '../navigation'
import { openExternal } from '../open-in-canvas'
import { FileActions } from './FilePreview'
import { useScrollIntoView } from './scroll'

/** Modules of the course; a module's items load when it is opened (M16 §4). */
export function ModulesView({ selected }: { selected?: string }) {
  const { courseId, query } = useCanvasPage()
  const [confirmUrl, setConfirmUrl] = useState<string | null>(null)
  const list = useQuery({
    ...lmsModulesListOptions({ path: { course_id: courseId }, query }),
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
        {(data) => (
          <div className="space-y-2">
            {data.items
              .toSorted((a, b) => (a.position ?? 0) - (b.position ?? 0))
              .map((module) => (
                <ModuleSection
                  key={module.external_id}
                  module={module}
                  focused={selected === module.external_id}
                  onExternal={setConfirmUrl}
                />
              ))}
          </div>
        )}
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

function ModuleSection({
  module,
  focused,
  onExternal,
}: {
  module: Module
  focused: boolean
  onExternal: (url: string) => void
}) {
  const [open, setOpen] = useState(focused)
  const ref = useScrollIntoView<HTMLDivElement>(focused ? module.external_id : undefined)
  const meta = [
    m.canvas_tab_module_items({ count: module.item_count ?? 0 }),
    module.unlock_at ? m.canvas_tab_unlocks_at({ time: formatDateTime(module.unlock_at) }) : null,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div ref={ref} className="rounded-xl border">
        <CollapsibleTrigger
          render={
            // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- the children label it
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left hover:bg-muted/50"
            />
          }
        >
          {open ? (
            <ChevronDown aria-hidden className="size-4 shrink-0" />
          ) : (
            <ChevronRight aria-hidden className="size-4 shrink-0" />
          )}
          <span className="min-w-0 flex-1 truncate font-medium">{module.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{meta}</span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t px-3 py-2">
            <ModuleItems moduleId={module.external_id} onExternal={onExternal} />
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}

const ICONS = {
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
  const { courseId, query } = useCanvasPage()
  const items = useQuery({
    ...lmsModuleItemsListOptions({ path: { course_id: courseId, module_id: moduleId }, query }),
    placeholderData: keepPreviousData,
  })
  return (
    <CanvasBoundary
      query={items}
      skeleton={<ListSkeleton rows={3} />}
      isEmpty={(data) => data.items.length === 0}
      empty={<p className="py-1 text-xs text-muted-foreground">{m.canvas_tab_module_empty()}</p>}
    >
      {(data) => (
        <ul className="space-y-0.5">
          {data.items
            .toSorted((a, b) => (a.position ?? 0) - (b.position ?? 0))
            .map((item) => (
              <li key={item.external_id} style={{ paddingLeft: `${(item.indent ?? 0) * 1.25}rem` }}>
                <ModuleItemRow item={item} onExternal={onExternal} />
              </li>
            ))}
        </ul>
      )}
    </CanvasBoundary>
  )
}

function ModuleItemRow({
  item,
  onExternal,
}: {
  item: ModuleItem
  onExternal: (url: string) => void
}) {
  const { go } = useCanvasPage()
  if (item.kind === 'subheader') {
    return <p className="pt-2 pb-1 text-xs font-medium text-muted-foreground">{item.title}</p>
  }
  const Icon = ICONS[item.kind]
  const label = (
    <>
      <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 truncate">{item.title}</span>
    </>
  )
  const rowClass = 'h-auto min-h-8 justify-start gap-2 px-2 py-1 font-normal'

  if (item.kind === 'file' && item.target) {
    return (
      <div className="flex items-center gap-2">
        <span className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1 text-sm">{label}</span>
        <FileActions fileId={item.target.ref} name={item.title} />
      </div>
    )
  }
  const inApp = item.target ? refLocation(item.target) : null
  if (inApp) {
    return (
      <Button variant="ghost" size="sm" className={`w-full ${rowClass}`} onClick={() => go(inApp)}>
        {label}
      </Button>
    )
  }
  if (item.kind === 'external_url' && item.external_url) {
    const url = item.external_url
    return (
      <Button
        variant="ghost"
        size="sm"
        className={`w-full ${rowClass}`}
        onClick={() => onExternal(url)}
      >
        {label}
        <ExternalLink aria-hidden className="ml-auto size-3.5 text-muted-foreground" />
      </Button>
    )
  }
  if (item.web_url) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className={`w-full ${rowClass}`}
        nativeButton={false}
        // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- the children label it
        render={<a href={item.web_url} target="_blank" rel="noopener noreferrer" />}
      >
        {label}
        <ExternalLink aria-hidden className="ml-auto size-3.5 text-muted-foreground" />
      </Button>
    )
  }
  return <span className="flex items-center gap-2 px-2 py-1 text-sm">{label}</span>
}
