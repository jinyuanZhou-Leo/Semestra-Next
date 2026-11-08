import type { ItemOut } from '@semestra/api-client'
import { filesItemGetOptions } from '@semestra/api-client/react-query'
import { useQueries } from '@tanstack/react-query'
import { FileX, Star } from 'lucide-react'
import type { CardProps } from '@/app/extensions'
import { useDialogTarget } from '@/lib/dialog-target'
import { m } from '@/paraglide/messages'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { Item, ItemContent, ItemGroup, ItemMedia, ItemTitle } from '@/ui/item'
import { Skeleton } from '@/ui/skeleton'
import { useExternalLink } from '../components/ExternalLink'
import { PreviewDialog, type PreviewTarget } from '../components/PreviewDialog'
import type { QuickOpenSettings } from './quick-open'
import { FileIcon } from '../components/FileIcon'

const LIMIT: Record<string, number> = { s: 3, m: 6, l: 12 }

/** Files the user chose for one-click opening (M07 §6.3). */
export default function QuickOpenCard({ size, settings }: CardProps<QuickOpenSettings>) {
  const ids = (settings.item_ids ?? []).slice(0, LIMIT[size] ?? 12)
  const preview = useDialogTarget<PreviewTarget>()
  const link = useExternalLink()
  const items = useQueries({
    queries: ids.map((id) => ({
      ...filesItemGetOptions({ path: { item_id: id } }),
      retry: false,
    })),
  })

  if (ids.length === 0) {
    return (
      <Empty className="border-0 p-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Star aria-hidden />
          </EmptyMedia>
          <EmptyTitle>{m.files_quick_open_empty()}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  }

  // A deleted file disappears; the settings are cleaned up the next time they are saved.
  if (items.every((query) => query.isError)) {
    return (
      <Empty className="border-0 p-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileX aria-hidden />
          </EmptyMedia>
          <EmptyTitle>{m.files_quick_open_gone()}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  }

  const open = (item: ItemOut) => {
    if (item.kind === 'link' && item.url) link.open(item.url)
    else preview.show({ itemId: item.id })
  }

  return (
    <>
      <ItemGroup className="gap-1">
        {items.map((query, index) => {
          const item = query.data
          if (query.isError) return null
          return item ? (
            <Item
              key={ids[index]}
              size="xs"
              className="gap-2 rounded-lg px-1 py-1 text-left hover:bg-muted/50"
              // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- the children label it
              render={<button type="button" onClick={() => open(item)} />}
            >
              <ItemMedia className="text-muted-foreground">
                <FileIcon item={item} aria-hidden className="size-4" />
              </ItemMedia>
              <ItemContent className="min-w-0">
                <ItemTitle className="w-full truncate font-normal">{item.display_name}</ItemTitle>
              </ItemContent>
            </Item>
          ) : (
            <Skeleton key={ids[index]} className="h-7 w-full" />
          )
        })}
      </ItemGroup>
      {link.dialog}
      <PreviewDialog target={preview.target} {...preview.props} />
    </>
  )
}
