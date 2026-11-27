import type { Course, FolderOut, ItemOut } from '@semestra/api-client'
import { useQueries } from '@tanstack/react-query'
import { ChevronRight, CircleAlert, Folder, Search, X } from 'lucide-react'
import { type ReactNode, useId, useState } from 'react'
import { courseColor, courseLabel } from '@/modules/academics/color'
import { COLLAPSE } from '@/lib/collapse'
import { clearOnEscape, clearSearch } from '@/lib/search-input'
import { FRAMED_SCROLLBAR } from '@/lib/scroll-area'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Alert, AlertAction, AlertTitle } from '@/ui/alert'
import { Button } from '@/ui/button'
import { Checkbox } from '@/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/ui/collapsible'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/ui/input-group'
import { ScrollArea } from '@/ui/scroll-area'
import { Skeleton } from '@/ui/skeleton'
import { compareNames } from '../folders'
import { courseFilesOptions } from '../queries'
import { FileIcon } from './FileIcon'

/** Courses with up to this many files open with every folder expanded. */
const EXPAND_ALL_UP_TO = 15

/** Each level of the tree is indented by this much. */
const INDENT_REM = 1.25

const ROW = 'flex h-9 items-center gap-2 rounded-xl pr-2.5 text-sm transition-colors duration-100'

type Node =
  | { kind: 'course'; key: string; course: Course; children: Node[]; files: string[] }
  | { kind: 'folder'; key: string; folder: FolderOut; children: Node[]; files: string[] }
  | { kind: 'file'; key: string; item: ItemOut }

/** A folder (or course) node with the files under it, at any depth. */
type Branch = Extract<Node, { files: string[] }>

function buildBranch(
  folders: readonly FolderOut[],
  items: readonly ItemOut[],
  parent: string | null,
  path: readonly string[],
  needle: string,
): { nodes: Node[]; files: string[] } {
  const nodes: Node[] = []
  const files: string[] = []
  for (const folder of folders
    .filter((f) => f.parent_id === parent)
    .toSorted((a, b) => compareNames(a.name, b.name))) {
    const inner = buildBranch(folders, items, folder.id, [...path, folder.name], needle)
    // A folder with nothing to pick in it is left out.
    if (inner.files.length === 0) continue
    nodes.push({
      kind: 'folder',
      key: `folder:${folder.id}`,
      folder,
      children: inner.nodes,
      files: inner.files,
    })
    files.push(...inner.files)
  }
  for (const item of items
    .filter((i) => i.folder_id === parent)
    .toSorted((a, b) => compareNames(a.display_name, b.display_name))) {
    // A search matches the file's name or a folder it is in.
    if (needle && ![...path, item.display_name].some((n) => n.toLowerCase().includes(needle)))
      continue
    nodes.push({ kind: 'file', key: `item:${item.id}`, item })
    files.push(item.id)
  }
  return { nodes, files }
}

type TreeState = {
  mode: 'multiple' | 'single'
  isOpen: (key: string) => boolean
  setOpen: (key: string, open: boolean) => void
  selected: ReadonlySet<string>
  full: boolean
  disabled: boolean
  toggle: (id: string, on: boolean) => void
  pick: (item: ItemOut) => void
  meta?: (item: ItemOut) => ReactNode
  baseId: string
}

function BranchRow({ node, depth, state }: { node: Branch; depth: number; state: TreeState }) {
  const open = state.isOpen(node.key)
  const chosen = node.files.filter((id) => state.selected.has(id)).length
  const name = node.kind === 'course' ? courseLabel(node.course) : node.folder.name
  return (
    <Collapsible open={open} onOpenChange={(next) => state.setOpen(node.key, next)}>
      <CollapsibleTrigger
        className={cn(
          ROW,
          'w-full text-left outline-none hover:bg-muted focus-visible:bg-muted',
          node.kind === 'course' && 'font-medium',
        )}
        style={{ paddingLeft: `${depth * INDENT_REM + 0.5}rem` }}
      >
        <ChevronRight
          aria-hidden
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform duration-200',
            open && 'rotate-90',
          )}
        />
        {node.kind === 'course' ? (
          <span
            aria-hidden
            className="mx-0.75 size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: courseColor(node.course) }}
          />
        ) : (
          <Folder aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate" title={name}>
          {name}
        </span>
        {/* Open, its ticked rows are in sight; closed, this keeps them from being forgotten. */}
        {state.mode === 'multiple' && !open && chosen > 0 ? (
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {m.files_picker_chosen({ count: chosen })}
          </span>
        ) : null}
      </CollapsibleTrigger>
      <CollapsibleContent className={COLLAPSE}>
        <Rows nodes={node.children} depth={depth + 1} state={state} />
      </CollapsibleContent>
    </Collapsible>
  )
}

function FileRow({ item, depth, state }: { item: ItemOut; depth: number; state: TreeState }) {
  const indent = { paddingLeft: `${depth * INDENT_REM + 0.5}rem` }
  const meta = state.meta?.(item)
  const body = (
    <>
      <FileIcon item={item} aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate" title={item.display_name}>
        {item.display_name}
      </span>
      {meta ? <span className="shrink-0 text-xs text-muted-foreground">{meta}</span> : null}
    </>
  )
  if (state.mode === 'single') {
    return (
      <button
        type="button"
        className={cn(ROW, 'w-full text-left outline-none hover:bg-muted focus-visible:bg-muted')}
        style={indent}
        onClick={() => state.pick(item)}
      >
        <span aria-hidden className="size-4 shrink-0" />
        {body}
      </button>
    )
  }
  const id = `${state.baseId}-${item.id}`
  const checked = state.selected.has(item.id)
  return (
    <label
      htmlFor={id}
      className={cn(ROW, 'cursor-pointer hover:bg-muted', checked && 'bg-primary/5')}
      style={indent}
    >
      <Checkbox
        id={id}
        checked={checked}
        disabled={state.disabled || (!checked && state.full)}
        onCheckedChange={(on) => state.toggle(item.id, on)}
      />
      {body}
    </label>
  )
}

function Rows({ nodes, depth, state }: { nodes: Node[]; depth: number; state: TreeState }) {
  return nodes.map((node) =>
    node.kind === 'file' ? (
      <FileRow key={node.key} item={node.item} depth={depth} state={state} />
    ) : (
      <BranchRow key={node.key} node={node} depth={depth} state={state} />
    ),
  )
}

/**
 * Pick course files: one course's folders, or each course of a term at the top. A search box
 * above filters by file and folder names; folders holding picked files say how many.
 */
export function FilePicker({
  courseId,
  courses = [],
  mode = 'multiple',
  selected = [],
  onChange,
  onPick,
  max,
  filter,
  meta,
  emptyTitle,
  className,
  disabled = false,
}: {
  /** One course: its folders at the top. */
  courseId?: string
  /** Several courses (a term): each course at the top, its folders inside. */
  courses?: readonly Course[]
  mode?: 'multiple' | 'single'
  selected?: readonly string[]
  onChange?: (selected: string[]) => void
  /** Single mode: the file clicked. */
  onPick?: (item: ItemOut) => void
  max?: number
  /** Which files and links can be picked; others are not shown. */
  filter?: (item: ItemOut) => boolean
  /** Short text at the end of a file's row (its date, "Processing"). */
  meta?: (item: ItemOut) => ReactNode
  emptyTitle: string
  /** Sizes the scrolling list (`h-72`, `flex-1`). */
  className?: string
  /** Ticks cannot change (while the picked files are being sent). */
  disabled?: boolean
}) {
  const baseId = useId()
  const [search, setSearch] = useState('')
  const ids = courseId ? [courseId] : courses.map((course) => course.id)
  const lists = useQueries({ queries: ids.map((id) => courseFilesOptions(id)) })
  const needle = search.trim().toLowerCase()
  const pending = lists.some((list) => list.isPending)
  const failed = lists.filter((list) => list.isError)
  const pickable = (index: number) =>
    (lists[index]?.data?.items ?? []).filter((i) => filter?.(i) ?? true)
  const branches = ids.map((id, index) => ({
    id,
    ...buildBranch(lists[index]?.data?.folders ?? [], pickable(index), null, [], needle),
  }))
  const total = branches.reduce((sum, b) => sum + b.files.length, 0)
  // What starts open is worked out from the files as they are and the picks the picker opened
  // with: a small course opens whole, a large one only where picked files are. Ticking or
  // unticking later never opens or closes anything; once the user opens or closes a folder, the
  // tree is theirs.
  const [openedWith] = useState(() => new Set(selected))
  const [expanded, setExpandedKeys] = useState<ReadonlySet<string> | null>(null)
  const initial = (): Set<string> => {
    const open = new Set<string>()
    ids.forEach((id, index) => {
      const whole = buildBranch(lists[index]?.data?.folders ?? [], pickable(index), null, [], '')
      const small = whole.files.length <= EXPAND_ALL_UP_TO
      const visit = (nodes: Node[]): boolean => {
        let holds = false
        for (const node of nodes) {
          if (node.kind === 'file') {
            if (openedWith.has(node.item.id)) holds = true
            continue
          }
          const inner = visit(node.children)
          if (inner || small) open.add(node.key)
          if (inner) holds = true
        }
        return holds
      }
      if (visit(whole.nodes) || small) open.add(`course:${id}`)
    })
    return open
  }
  const openKeys = expanded ?? initial()
  // While searching every match shows with the folders above it; one closed during the search
  // stays closed until the search changes.
  const [closedInSearch, setClosedInSearch] = useState<ReadonlySet<string>>(new Set())
  const changeSearch = (value: string) => {
    setSearch(value)
    setClosedInSearch(new Set())
  }
  const chosen = new Set(selected)
  const state: TreeState = {
    mode,
    isOpen: (key) => (needle ? !closedInSearch.has(key) : openKeys.has(key)),
    setOpen: (key, open) => {
      if (needle) {
        const next = new Set(closedInSearch)
        if (open) next.delete(key)
        else next.add(key)
        setClosedInSearch(next)
        return
      }
      const next = new Set(openKeys)
      if (open) next.add(key)
      else next.delete(key)
      setExpandedKeys(next)
    },
    selected: chosen,
    full: max !== undefined && chosen.size >= max,
    disabled,
    toggle: (id, on) =>
      onChange?.(on ? [...selected.filter((x) => x !== id), id] : selected.filter((x) => x !== id)),
    pick: (item) => onPick?.(item),
    meta,
    baseId,
  }
  const problem =
    failed.length > 0 ? (
      <Alert variant="destructive" className="shrink-0">
        <CircleAlert aria-hidden />
        <AlertTitle>{courseId ? m.files_picker_failed() : m.files_picker_failed_some()}</AlertTitle>
        <AlertAction>
          <Button
            size="sm"
            variant="outline"
            onClick={() => failed.forEach((list) => void list.refetch())}
          >
            {m.common_retry()}
          </Button>
        </AlertAction>
      </Alert>
    ) : null

  if (!pending && failed.length === 0 && total === 0 && !needle) {
    return (
      <Empty className={cn('rounded-2xl border border-solid border-border p-6', className)}>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Folder aria-hidden />
          </EmptyMedia>
          <EmptyTitle>{emptyTitle}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className={cn('flex min-h-0 flex-col gap-2', className)}>
      {problem}
      <InputGroup className="shrink-0">
        <InputGroupInput
          type="search"
          aria-label={m.files_picker_search()}
          placeholder={m.files_picker_search()}
          value={search}
          onChange={(event) => changeSearch(event.target.value)}
          onKeyDown={clearOnEscape(search, () => changeSearch(''))}
        />
        <InputGroupAddon>
          <Search aria-hidden />
        </InputGroupAddon>
        <InputGroupAddon align="inline-end">
          {search ? (
            <InputGroupButton
              size="icon-xs"
              aria-label={m.common_search_clear()}
              onClick={(event) => clearSearch(event, () => changeSearch(''))}
            >
              <X aria-hidden />
            </InputGroupButton>
          ) : null}
        </InputGroupAddon>
      </InputGroup>
      {/* The padding sits outside the scrolling area, so rows scrolled under the frame are cut
          along the rows' own radius, not the frame's. */}
      <div className="flex min-h-0 flex-1 flex-col rounded-2xl border p-1">
        <ScrollArea className={cn('min-h-0 flex-1 rounded-xl', FRAMED_SCROLLBAR)}>
          <div className="pr-1.5">
            {pending ? (
              <div className="flex flex-col gap-1 p-1">
                <Skeleton className="h-7 rounded-lg" />
                <Skeleton className="h-7 rounded-lg" />
                <Skeleton className="h-7 rounded-lg" />
              </div>
            ) : total === 0 && (needle || failed.length === 0) ? (
              <p className="px-2.5 py-2 text-xs text-muted-foreground">
                {m.files_picker_no_match()}
              </p>
            ) : courseId ? (
              <Rows nodes={branches[0]?.nodes ?? []} depth={0} state={state} />
            ) : (
              courses.map((course, index) => {
                const branch = branches[index]
                if (!branch || branch.files.length === 0) return null
                return (
                  <BranchRow
                    key={course.id}
                    node={{
                      kind: 'course',
                      key: `course:${course.id}`,
                      course,
                      children: branch.nodes,
                      files: branch.files,
                    }}
                    depth={0}
                    state={state}
                  />
                )
              })
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
