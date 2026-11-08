import type { ItemOut } from '@semestra/api-client'
import { FileClock } from 'lucide-react'
import { CardSkeleton } from '@/app/board/CardSkeleton'
import type { CardProps } from '@/app/extensions'
import { useDialogTarget } from '@/lib/dialog-target'
import { formatDate } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { Item, ItemActions, ItemContent, ItemGroup, ItemMedia, ItemTitle } from '@/ui/item'
import { useExternalLink } from '../components/ExternalLink'
import { PreviewDialog, type PreviewTarget } from '../components/PreviewDialog'
import { useCourseFiles } from '../queries'
import { FileIcon } from '../components/FileIcon'

const LIMIT = 5

/** The course's most recently added files (M07 §6.3). */
export default function RecentCard({ scope }: CardProps) {
  const courseId = scope.kind === 'course' ? scope.courseId : ''
  const list = useCourseFiles(courseId)
  const preview = useDialogTarget<PreviewTarget>()
  const link = useExternalLink()

  if (!list.data) return <CardSkeleton />
  const recent = list.data.items
    .toSorted((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, LIMIT)
  if (recent.length === 0) {
    return (
      <Empty className="border-0 p-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileClock aria-hidden />
          </EmptyMedia>
          <EmptyTitle>{m.files_recent_empty()}</EmptyTitle>
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
        {recent.map((item) => (
          <Item
            key={item.id}
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
            <ItemActions className="text-xs text-muted-foreground">
              {formatDate(item.created_at)}
            </ItemActions>
          </Item>
        ))}
      </ItemGroup>
      {link.dialog}
      <PreviewDialog target={preview.target} {...preview.props} />
    </>
  )
}
