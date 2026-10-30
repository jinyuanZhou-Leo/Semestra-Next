import type { ItemOut } from '@semestra/api-client'
import { FileClock } from 'lucide-react'
import { useState } from 'react'
import { CardSkeleton } from '@/app/board/CardSkeleton'
import type { CardProps } from '@/app/extensions'
import { formatDate } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { useExternalLink } from '../components/ExternalLink'
import { PreviewDialog, type PreviewTarget } from '../components/PreviewDialog'
import { useCourseFiles } from '../queries'
import { FileIcon } from '../components/FileIcon'

const LIMIT = 5

/** The course's most recently added files (M07 §6.3). */
export default function RecentCard({ scope }: CardProps) {
  const courseId = scope.kind === 'course' ? scope.courseId : ''
  const list = useCourseFiles(courseId)
  const [preview, setPreview] = useState<PreviewTarget | null>(null)
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
    else setPreview({ itemId: item.id })
  }
  return (
    <>
      <ul className="space-y-1 text-sm">
        {recent.map((item) => {
          return (
            <li key={item.id}>
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
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatDate(item.created_at)}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      {link.dialog}
      <PreviewDialog target={preview} onClose={() => setPreview(null)} />
    </>
  )
}
