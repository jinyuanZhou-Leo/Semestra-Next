import type { FolderOut, ItemOut } from '@semestra/api-client'
import { Folder } from 'lucide-react'
import { memo, useState } from 'react'
import { formatBytes } from '@/lib/format'
import { cn } from '@/lib/utils'
import { DROP_TARGET } from '../hooks'
import { previewKind, typeLabel } from '../kinds'
import { pageImageUrl } from '../queries'
import type { Target } from '../folders'
import { NewDot, SelectBox, useFolderDnd, useHandlers } from './browser'
import { useDragSource } from './FileDrag'
import { FileIcon } from './FileIcon'
import { FolderMenu, ItemMenu, PinButton } from './ItemMenus'
import { StatusCell } from './StatusCell'

type TileProps = {
  selected: boolean
  /** Something is selected: every checkbox shows, not only on hover. */
  selecting: boolean
}

const FolderTile = memo(function FolderTile({
  folder,
  selected,
  selecting,
  dropOver,
  fresh,
}: TileProps & { folder: FolderOut; dropOver: boolean; fresh: boolean }) {
  const { openFolder } = useHandlers()
  const dnd = useFolderDnd(folder, dropOver)
  const target: Target = { type: 'folder', folder }
  return (
    <div
      {...dnd.props}
      className={cn(
        'group relative flex h-14 items-center gap-2.5 rounded-xl border bg-card px-3 transition-[background-color,border-color,opacity] hover:bg-muted/50',
        selected && 'border-primary bg-primary/5',
        dnd.moving && 'opacity-50',
        DROP_TARGET,
        'data-drop-target:border-primary',
      )}
    >
      {/* The checkbox takes the icon's place on hover or while selecting. */}
      <div className="relative z-10 grid size-4 shrink-0 place-items-center">
        <Folder
          aria-hidden
          className={cn(
            'size-4 text-muted-foreground transition-opacity',
            (selecting || selected) && 'opacity-0',
            'group-focus-within:opacity-0 group-hover:opacity-0',
          )}
        />
        <SelectBox
          target={target}
          className={cn(
            'absolute inset-0 transition-opacity',
            !(selecting || selected) &&
              'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100',
          )}
        />
      </div>
      <button
        type="button"
        onClick={() => openFolder(folder.id)}
        className="flex min-w-0 flex-1 items-center text-left text-sm after:absolute after:inset-0"
      >
        <span className="truncate font-medium">{folder.name}</span>
        {fresh ? <NewDot className="ml-2" /> : null}
      </button>
      <div className="relative">
        <FolderMenu folder={folder} />
      </div>
    </div>
  )
})

const ItemTile = memo(function ItemTile({
  item,
  selected,
  selecting,
}: TileProps & { item: ItemOut }) {
  const { open } = useHandlers()
  const target: Target = { type: 'item', item }
  const { attach, listeners, moving } = useDragSource(target)
  const [broken, setBroken] = useState(false)
  // Page images are only made for PDFs and images; anything else gets its icon.
  const kind = previewKind(item)
  const thumbnail =
    !broken &&
    (kind === 'pdf' || kind === 'image') &&
    item.doc_status === 'ready' &&
    (item.page_count ?? 0) > 0
  return (
    <div
      ref={attach}
      {...listeners}
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-xl border bg-card transition-[border-color,box-shadow,opacity]',
        selected && 'border-primary ring-1 ring-primary',
        moving && 'opacity-50',
      )}
    >
      <SelectBox
        target={target}
        className={cn(
          'absolute top-2.5 left-2.5 z-10 bg-background shadow-sm transition-opacity',
          !(selecting || selected) &&
            'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100',
        )}
      />
      <div className="flex aspect-[4/3] items-center justify-center overflow-hidden bg-muted/50">
        {thumbnail ? (
          <img
            src={pageImageUrl(item.id, 1)}
            alt=""
            loading="lazy"
            draggable={false}
            onError={() => setBroken(true)}
            className="size-full object-cover object-top"
          />
        ) : (
          <FileIcon item={item} aria-hidden className="size-10 text-muted-foreground" />
        )}
      </div>
      <div className="flex h-12 items-center gap-1 px-3">
        <button
          type="button"
          onClick={() => open(item)}
          className="min-w-0 flex-1 text-left text-sm after:absolute after:inset-0"
        >
          <span className="flex items-center gap-2">
            <span className="truncate font-medium">{item.display_name}</span>
            {item.unseen ? <NewDot /> : null}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {[typeLabel(item), item.kind === 'file' ? formatBytes(item.size_bytes) : null]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </button>
        <div className="relative flex items-center">
          <StatusCell item={item} compact />
          <PinButton item={item} />
          <ItemMenu item={item} />
        </div>
      </div>
    </div>
  )
})

/** The grid view: folders first, then the files as tiles with page thumbnails. */
export function FileGrid({
  folders,
  items,
  isSelected,
  selecting,
  dropOver,
  fresh,
}: {
  folders: readonly FolderOut[]
  /** In the chosen sort. */
  items: readonly ItemOut[]
  isSelected: (target: Target) => boolean
  selecting: boolean
  dropOver: string | null
  fresh: ReadonlySet<string>
}) {
  return (
    <div className="space-y-3">
      {folders.length > 0 ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-3">
          {folders.map((folder) => (
            <FolderTile
              key={folder.id}
              folder={folder}
              selected={isSelected({ type: 'folder', folder })}
              selecting={selecting}
              dropOver={dropOver === folder.id}
              fresh={fresh.has(folder.id)}
            />
          ))}
        </div>
      ) : null}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-3">
        {items.map((item) => (
          <ItemTile
            key={item.id}
            item={item}
            selected={isSelected({ type: 'item', item })}
            selecting={selecting}
          />
        ))}
      </div>
    </div>
  )
}
