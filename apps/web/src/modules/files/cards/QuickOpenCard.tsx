import type { ItemOut } from '@semestra/api-client'
import { filesItemGetOptions } from '@semestra/api-client/react-query'
import { useQueries } from '@tanstack/react-query'
import { FileX, Star } from 'lucide-react'
import { useState } from 'react'
import type { CardProps } from '@/app/extensions'
import { m } from '@/paraglide/messages'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { Skeleton } from '@/ui/skeleton'
import { useExternalLink } from '../components/ExternalLink'
import { PreviewDialog, type PreviewTarget } from '../components/PreviewDialog'
import type { QuickOpenSettings } from './quick-open'
import { FileIcon } from '../components/FileIcon'

const LIMIT: Record<string, number> = { s: 3, m: 6, l: 12 }

/** Files the user chose for one-click opening (M07 §6.3). */
export default function QuickOpenCard({ size, settings }: CardProps<QuickOpenSettings>) {
  const ids = (settings.item_ids ?? []).slice(0, LIMIT[size] ?? 12)
  const [preview, setPreview] = useState<PreviewTarget | null>(null)
  const link = useExternalLink()
  const items = useQueries({
    queries: ids.map((id) => ({
      ...filesItemGetOptions({ path: { item_id: id } }),
      staleTime: 30_000,
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
    else setPreview({ itemId: item.id })
  }

  return (
    <>
      <ul className="space-y-1 text-sm">
        {items.map((query, index) => {
          const item = query.data
          if (query.isError) return null
          return (
            <li key={ids[index]}>
              {item ? (
                <button
                  type="button"
                  onClick={() => open(item)}
                  className="flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left hover:bg-muted/50"
                >
                  <FileIcon
                    item={item}
                    aria-hidden
                    className="size-4 shrink-0 text-muted-foreground"
                  />
                  <span className="min-w-0 flex-1 truncate">{item.display_name}</span>
                </button>
              ) : (
                <Skeleton className="h-7 w-full" />
              )}
            </li>
          )
        })}
      </ul>
      {link.dialog}
      <PreviewDialog target={preview} onClose={() => setPreview(null)} />
    </>
  )
}
