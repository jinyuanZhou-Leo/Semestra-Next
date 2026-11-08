import type { FolderOut } from '@semestra/api-client'
import { filesFolderCreateMutation } from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronRight, Folder, FolderPlus, FolderRoot, Search } from 'lucide-react'
import { useState } from 'react'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/ui/collapsible'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog'
import { FieldError } from '@/ui/field'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/ui/input-group'
import { useMoveTargets } from '../actions'
import {
  MAX_FOLDER_DEPTH,
  type Target,
  type FolderTree,
  canMoveInto,
  canMoveIntoNewFolder,
  depthOf,
  folderTree,
  pathTo,
  targetName,
  targetParent,
} from '../folders'
import { invalidateFiles } from '../queries'
import { NameDialog } from './NameDialog'

/** Courses with up to this many folders open with the whole tree expanded. */
const EXPAND_ALL_UP_TO = 40

/** Each level of the tree is indented by this much. */
const INDENT_REM = 1.25

type TreeState = {
  children: FolderTree['children']
  /** Folders shown while searching (matches and the folders above them); null = all. */
  visible: Set<string> | null
  expanded: Set<string>
  setExpanded: (id: string, open: boolean) => void
  selected: string | null | undefined
  select: (id: string | null) => void
  canPick: (id: string | null) => boolean
}

const ROW = 'flex h-9 items-center gap-1.5 rounded-xl pr-2.5 text-sm transition-colors duration-100'

function rowState(state: TreeState, id: string | null) {
  const picked = state.selected === id
  return {
    picked,
    className: cn(
      ROW,
      picked ? 'bg-primary/10 text-primary' : state.canPick(id) && 'hover:bg-muted',
      !state.canPick(id) && 'text-muted-foreground',
    ),
  }
}

function PickButton({
  state,
  id,
  name,
  icon: Icon,
}: {
  state: TreeState
  id: string | null
  name: string
  icon: typeof Folder
}) {
  const { picked } = rowState(state, id)
  return (
    <button
      type="button"
      disabled={!state.canPick(id)}
      aria-pressed={picked}
      onClick={() => state.select(id)}
      className="flex h-full min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:underline disabled:cursor-default"
    >
      <Icon
        aria-hidden
        className={cn('size-4 shrink-0', picked ? 'text-primary' : 'text-muted-foreground')}
      />
      <span className="truncate">{name}</span>
      {picked ? <Check aria-hidden className="ml-auto size-4 shrink-0" /> : null}
    </button>
  )
}

function TreeNode({
  folder,
  depth,
  state,
}: {
  folder: FolderOut
  depth: number
  state: TreeState
}) {
  const children = (state.children.get(folder.id) ?? []).filter(
    (c) => !state.visible || state.visible.has(c.id),
  )
  const { className } = rowState(state, folder.id)
  const indent = { paddingLeft: `${depth * INDENT_REM + 0.25}rem` }
  if (children.length === 0) {
    return (
      <div className={className} style={indent}>
        <span aria-hidden className="size-6 shrink-0" />
        <PickButton state={state} id={folder.id} name={folder.name} icon={Folder} />
      </div>
    )
  }
  return (
    <Collapsible
      open={state.visible !== null || state.expanded.has(folder.id)}
      onOpenChange={(open) => state.setExpanded(folder.id, open)}
    >
      <div className={className} style={indent}>
        <CollapsibleTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={folder.name}
              className="shrink-0 hover:bg-transparent [&[data-panel-open]>svg]:rotate-90"
            />
          }
        >
          <ChevronRight aria-hidden className="transition-transform duration-200" />
        </CollapsibleTrigger>
        <PickButton state={state} id={folder.id} name={folder.name} icon={Folder} />
      </div>
      <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-out data-ending-style:h-0 data-starting-style:h-0">
        {children.map((child) => (
          <TreeNode key={child.id} folder={child} depth={depth + 1} state={state} />
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}

/** Folders whose name contains `needle`, with every folder above them. */
function matching(tree: FolderTree, needle: string): Set<string> {
  const visible = new Set<string>()
  for (const folder of tree.byId.values()) {
    if (!folder.name.toLowerCase().includes(needle)) continue
    visible.add(folder.id)
    for (const id of tree.ancestors.get(folder.id) ?? []) visible.add(id)
  }
  return visible
}

/**
 * Pick where files and folders go, from the course's folder tree (M07 §6.1). Places they cannot
 * go (where they already are, a folder into itself, too deep) are greyed out.
 */
export function MoveDialog({
  courseId,
  targets,
  folders,
  onClose,
  onDone,
}: {
  courseId: string
  targets: Target[]
  folders: readonly FolderOut[]
  onClose: () => void
  /** After the move went through. */
  onDone?: () => void
}) {
  const queryClient = useQueryClient()
  const move = useMoveTargets()
  const createFolder = useMutation({
    ...filesFolderCreateMutation(),
    onSuccess: () => invalidateFiles(queryClient),
  })
  const tree = folderTree(folders)
  const [selected, setSelected] = useState<string | null | undefined>(undefined)
  const [search, setSearch] = useState('')
  const [naming, setNaming] = useState(false)
  // Open: the folders above where the targets are now, or everything in a small course.
  const [expanded, setExpandedIds] = useState<Set<string>>(() =>
    folders.length <= EXPAND_ALL_UP_TO
      ? new Set(folders.map((f) => f.id))
      : new Set(pathTo(targets[0] ? targetParent(targets[0]) : null, tree).map((f) => f.id)),
  )
  const needle = search.trim().toLowerCase()
  const visible = needle ? matching(tree, needle) : null
  // Worked out once per render: every row asks while it draws.
  const pickable = new Set<string | null>(
    [null, ...tree.byId.keys()].filter((id) => canMoveInto(targets, id, tree)),
  )
  const state: TreeState = {
    children: tree.children,
    visible,
    expanded,
    setExpanded: (id, open) =>
      setExpandedIds((prev) => {
        const next = new Set(prev)
        if (open) next.add(id)
        else next.delete(id)
        return next
      }),
    selected,
    select: setSelected,
    canPick: (id) => pickable.has(id),
  }
  const topLevel = (state.children.get(null) ?? []).filter((f) => !visible || visible.has(f.id))
  // A new folder goes inside the picked one (or the top level), if that is not already deepest.
  const newFolderParent = selected ?? null
  const canCreate = depthOf(newFolderParent, tree) < MAX_FOLDER_DEPTH
  const title =
    targets.length === 1 && targets[0]
      ? m.files_move_title({ name: targetName(targets[0]) })
      : m.files_move_title_many({ count: targets.length })
  const pending = move.isPending

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <InputGroup>
              <InputGroupInput
                type="search"
                aria-label={m.files_move_search()}
                placeholder={m.files_move_search()}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <InputGroupAddon>
                <Search aria-hidden />
              </InputGroupAddon>
            </InputGroup>
            <fieldset
              aria-label={m.files_move_destination()}
              className="h-72 min-w-0 overflow-y-auto rounded-2xl border p-1"
            >
              {visible === null || topLevel.length > 0 ? (
                <>
                  <div className={cn(rowState(state, null).className, 'pl-2.5 font-medium')}>
                    <PickButton
                      state={state}
                      id={null}
                      name={m.files_all_files()}
                      icon={FolderRoot}
                    />
                  </div>
                  {topLevel.map((folder) => (
                    <TreeNode key={folder.id} folder={folder} depth={1} state={state} />
                  ))}
                </>
              ) : (
                <p className="px-2.5 py-2 text-xs text-muted-foreground">
                  {m.files_move_no_match()}
                </p>
              )}
            </fieldset>
            {move.error ? <FieldError>{errorMessage(move.error)}</FieldError> : null}
          </div>
          <DialogFooter className="sm:justify-between">
            <Button
              variant="outline"
              disabled={!canCreate || pending}
              onClick={() => setNaming(true)}
            >
              <FolderPlus aria-hidden />
              {m.files_new_folder()}
            </Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <DialogClose render={<Button variant="outline" disabled={pending} />}>
                {m.common_cancel()}
              </DialogClose>
              <Button
                disabled={selected === undefined || !pickable.has(selected) || pending}
                onClick={() => {
                  if (selected === undefined) return
                  move.mutate(
                    { courseId, targets, folderId: selected },
                    {
                      onSuccess: () => {
                        onDone?.()
                        onClose()
                      },
                    },
                  )
                }}
              >
                {pending ? m.common_saving() : m.files_move_here()}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {naming ? (
        <NameDialog
          open
          title={m.files_new_folder()}
          label={m.files_name()}
          initial=""
          submitLabel={m.files_create()}
          pending={createFolder.isPending}
          error={createFolder.error ? errorMessage(createFolder.error) : null}
          onClose={() => {
            createFolder.reset()
            setNaming(false)
          }}
          onSubmit={(name) =>
            createFolder.mutate(
              { path: { course_id: courseId }, body: { name, parent_id: newFolderParent } },
              {
                onSuccess: (folder) => {
                  if (newFolderParent) state.setExpanded(newFolderParent, true)
                  setSearch('')
                  // Only when what is being moved can go in it (a folder may be too deep).
                  if (canMoveIntoNewFolder(targets, newFolderParent, tree)) setSelected(folder.id)
                  setNaming(false)
                },
              },
            )
          }
        />
      ) : null}
    </>
  )
}
