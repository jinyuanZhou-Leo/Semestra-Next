import { lmsAnnouncementUnreadOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { School } from 'lucide-react'
import { CardSkeleton } from '@/app/board/CardSkeleton'
import type { CardProps } from '@/app/extensions'
import { coursePath } from '@/modules/academics/paths'
import { courseOverviewOptions } from '@/modules/lms/course-info'
import { m } from '@/paraglide/messages'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { NAV_ICONS } from '../icons'
import { navEntries } from '../navigation'
import { programLinksOptions } from '../open-in-canvas'
import type { ShortcutSettings } from './shortcut'

/** One place of a course's Canvas tab, the whole card a link to it (M16). */
export default function ShortcutCard({ scope, settings }: CardProps<ShortcutSettings>) {
  const programId = scope.programId
  const courseId = scope.kind === 'course' ? scope.courseId : ''
  const place = settings.place ?? 'last'
  const links = useQuery(programLinksOptions(programId))
  const linked = links.data?.items.some((l) => l.course_id === courseId && l.provider === 'canvas')
  const overview = useQuery({ ...courseOverviewOptions(courseId), enabled: Boolean(linked) })
  const unread = useQuery(lmsAnnouncementUnreadOptions({ path: { program_id: programId } })).data

  if (links.isPending || (linked && overview.isPending)) return <CardSkeleton />
  if (!linked || !overview.data) {
    return (
      <Empty className="border-0 p-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <School aria-hidden />
          </EmptyMedia>
          <EmptyTitle>{m.canvas_tab_card_unlinked()}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  }
  const entry =
    place === 'last' ? undefined : navEntries(overview.data.navigation).find((e) => e.key === place)
  const Icon = place === 'last' ? School : NAV_ICONS[place]
  const label = place === 'last' ? m.canvas_tab_page_title() : (entry?.label ?? m.canvas_tab_work())
  const count =
    place === 'announcements'
      ? (unread?.items.find((c) => c.course_id === courseId)?.unread ?? 0)
      : 0
  const base = coursePath(programId, courseId, 'canvas')
  return (
    <Link
      to={place === 'last' ? base : `${base}?tab=${place}`}
      className="-m-2 flex flex-1 flex-col items-center justify-center gap-2 rounded-xl p-2 hover:bg-muted/50"
    >
      <span className="relative">
        <Icon aria-hidden className="size-8 text-muted-foreground" />
        {count > 0 ? (
          <span className="absolute -top-1.5 -right-3 rounded-full bg-primary px-1.5 text-xs leading-5 text-primary-foreground tabular-nums">
            {count}
          </span>
        ) : null}
      </span>
      <span className="max-w-full truncate text-sm font-medium">{label}</span>
    </Link>
  )
}
