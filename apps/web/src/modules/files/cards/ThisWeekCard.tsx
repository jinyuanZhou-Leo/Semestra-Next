import type { ItemOut } from '@semestra/api-client'
import { Link } from '@tanstack/react-router'
import { CalendarDays } from 'lucide-react'
import { CardSkeleton } from '@/app/board/CardSkeleton'
import type { CardProps } from '@/app/extensions'
import { useDialogTarget } from '@/lib/dialog-target'
import { m } from '@/paraglide/messages'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/ui/button'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { Item, ItemActions, ItemContent, ItemGroup, ItemMedia, ItemTitle } from '@/ui/item'
import { useExternalLink } from '../components/ExternalLink'
import { FileIcon } from '../components/FileIcon'
import { PreviewDialog, type PreviewTarget } from '../components/PreviewDialog'
import { compareNames } from '../folders'
import { useCourseFiles } from '../queries'
import { inWeek, useCourseWeeks, weekName } from '../weeks'

// What fits above the link: one board row for m, two for l.
const LIMIT = { m: 3, l: 9 } as const

/** This week's materials of the course, each with its folder (M07 §6.3). */
export default function ThisWeekCard({ scope, size }: CardProps) {
  const courseId = scope.kind === 'course' ? scope.courseId : ''
  const list = useCourseFiles(courseId)
  const weeks = useCourseWeeks(courseId)
  const preview = useDialogTarget<PreviewTarget>()
  const link = useExternalLink()

  if (!list.data || !weeks) return <CardSkeleton />
  const week = weeks.current
  const folders = new Map(list.data.folders.map((f) => [f.id, f.name]))
  const place = (item: ItemOut) => (item.folder_id ? (folders.get(item.folder_id) ?? '') : '')
  const all = week
    ? list.data.items
        .filter((i) => inWeek(i, week.start, weeks))
        .toSorted(
          (a, b) =>
            compareNames(place(a), place(b)) || compareNames(a.display_name, b.display_name),
        )
    : []
  if (!week || all.length === 0) {
    return (
      <Empty className="border-0 p-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CalendarDays aria-hidden />
          </EmptyMedia>
          <EmptyTitle>{m.files_this_week_empty()}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  }
  const shown = all.slice(0, size === 'l' ? LIMIT.l : LIMIT.m)
  const open = (item: ItemOut) => {
    if (item.kind === 'link' && item.url) link.open(item.url)
    else preview.show({ itemId: item.id })
  }
  return (
    <div className="flex min-h-0 flex-col gap-1">
      <ItemGroup className="gap-1">
        {shown.map((item) => (
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
            <ItemActions className="max-w-1/3 truncate text-xs text-muted-foreground">
              {place(item)}
            </ItemActions>
          </Item>
        ))}
      </ItemGroup>
      {scope.kind === 'course' ? (
        <Link
          to="/p/$programId/c/$courseId/$page"
          params={{ programId: scope.programId, courseId, page: 'files' }}
          search={{ week: week.start }}
          className={cn(buttonVariants({ variant: 'link', size: 'sm' }), 'self-start px-1')}
        >
          {m.files_this_week_all({ week: weekName(week), count: all.length })}
        </Link>
      ) : null}
      {link.dialog}
      <PreviewDialog target={preview.target} {...preview.props} />
    </div>
  )
}
