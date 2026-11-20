import type { FilesItemList, FolderOut, ItemOut } from '@semestra/api-client'
import { type SortingState, useTable } from '@tanstack/react-table'
import { ArrowDown, ArrowUp, LayoutGrid, List } from 'lucide-react'
import { use } from 'react'
import { useUiPref } from '@/app/ui-pref'
import { RowSelectionContext } from '@/components/row-selection'
import { SEGMENT, SEGMENTED } from '@/lib/segmented'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { type Target, compareNames, targetKey } from '../folders'
import { BrowserContext, type BrowserHandlers } from './browser'
import { FileGrid } from './FileGrid'
import { FileTable, columns, features } from './FileTable'

const DEFAULT_SORT: SortingState = [{ id: 'name', desc: false }]

/** The sort the user picked, shared by the list and grid views of every course. */
export function useFileSort() {
  return useUiPref<SortingState>('files.sort', DEFAULT_SORT)
}

const SORT_FIELDS = [
  ['name', () => m.files_name()],
  ['size', () => m.files_size()],
  ['updated', () => m.files_modified()],
] as const

/** The grid has no column headers, so its sort is picked from this menu. */
export function SortMenu() {
  const [sorting, setSorting] = useFileSort()
  const current = sorting[0] ?? DEFAULT_SORT[0]
  const label = SORT_FIELDS.find(([id]) => id === current?.id)?.[1]() ?? m.files_name()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" />}>
        {current?.desc ? <ArrowDown aria-hidden /> : <ArrowUp aria-hidden />}
        {label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{m.files_sort_by()}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={current?.id}
            onValueChange={(id) => setSorting([{ id, desc: current?.desc ?? false }])}
          >
            {SORT_FIELDS.map(([id, text]) => (
              <DropdownMenuRadioItem key={id} value={id}>
                {text()}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={current?.desc ? 'desc' : 'asc'}
          onValueChange={(dir) => setSorting([{ id: current?.id ?? 'name', desc: dir === 'desc' }])}
        >
          <DropdownMenuRadioItem value="asc">{m.files_sort_ascending()}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="desc">{m.files_sort_descending()}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** List or grid, remembered for every files page (`files.view`). */
export function ViewToggle() {
  const [view, setView] = useUiPref<'list' | 'grid'>('files.view', 'list')
  return (
    <ToggleGroup
      aria-label={m.files_view()}
      size="sm"
      className={SEGMENTED}
      value={[view]}
      onValueChange={(next) => {
        if (next[0]) setView(next[0] as 'list' | 'grid')
      }}
    >
      {(
        [
          ['list', List, m.files_view_list()],
          ['grid', LayoutGrid, m.files_view_grid()],
        ] as const
      ).map(([value, Icon, label]) => (
        <Tooltip key={value}>
          <TooltipTrigger
            render={<ToggleGroupItem value={value} aria-label={label} className={SEGMENT} />}
          >
            <Icon aria-hidden />
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      ))}
    </ToggleGroup>
  )
}

/**
 * The folders and files in one folder of a course (`folderId` null: its top level), as a sortable
 * table or a grid of tiles (M07 §6.1). Folders always come first, by name; the chosen sort applies
 * to files.
 *
 * It picks the folder's entries from the course's whole list itself: they then stay the same
 * arrays from one render to the next, and so do the table's rows, which lets a row skip
 * rendering when only another row's checkbox or drop state changed. Filtered by the page, they
 * would be new each time (the page hands them on to its selection hook, so the compiler cannot
 * keep them).
 */
export function FileBrowser({
  list,
  folderId,
  view,
  handlers,
  dropOver,
}: {
  list: FilesItemList
  folderId: string | null
  view: 'list' | 'grid'
  handlers: BrowserHandlers
  /** The folder files are dragged over. */
  dropOver?: string | null
}) {
  const folders = list.folders
    .filter((f) => f.parent_id === folderId)
    .toSorted((a, b) => compareNames(a.name, b.name))
  const items = list.items.filter((i) => i.folder_id === folderId)
  // Folders with something not opened in them, at any depth.
  const parents = new Map(list.folders.map((f) => [f.id, f.parent_id]))
  const fresh = new Set<string>()
  for (const item of list.items) {
    if (!item.unseen) continue
    for (let id = item.folder_id; id && !fresh.has(id); id = parents.get(id) ?? null) fresh.add(id)
  }
  return (
    <BrowserContext value={handlers}>
      <Entries
        folders={folders}
        items={items}
        view={view}
        dropOver={dropOver ?? null}
        fresh={fresh}
      />
    </BrowserContext>
  )
}

function Entries({
  folders: sortedFolders,
  items,
  view,
  dropOver,
  fresh,
}: {
  folders: readonly FolderOut[]
  items: readonly ItemOut[]
  view: 'list' | 'grid'
  dropOver: string | null
  fresh: ReadonlySet<string>
}) {
  // The page provides the selection: its toolbar acts on it too.
  const selection = use(RowSelectionContext)
  if (!selection) throw new Error('FileBrowser renders inside RowSelectionContext')
  const selected = (target: Target) => selection.has(targetKey(target))
  const selecting = selection.ids.length > 0
  const [sorting, setSorting] = useFileSort()
  const table = useTable({
    features,
    columns,
    data: items as ItemOut[],
    getRowId: (item) => item.id,
    state: { sorting },
    onSortingChange: (updater) =>
      setSorting(typeof updater === 'function' ? updater(sorting) : updater),
  })
  // Pinned files stay on top whatever the sort.
  const rows = table
    .getRowModel()
    .rows.toSorted((a, b) => Number(b.original.pinned) - Number(a.original.pinned))

  if (view === 'grid') {
    return (
      <FileGrid
        folders={sortedFolders}
        items={rows.map((row) => row.original)}
        isSelected={selected}
        selecting={selecting}
        dropOver={dropOver}
        fresh={fresh}
      />
    )
  }
  return (
    <FileTable
      table={table}
      rows={rows}
      folders={sortedFolders}
      isSelected={selected}
      dropOver={dropOver}
      fresh={fresh}
    />
  )
}
