import { Link } from '@tanstack/react-router'
import { CircleAlert, Megaphone } from 'lucide-react'
import { CardSkeleton } from '@/app/board/CardSkeleton'
import type { CardProps } from '@/app/extensions'
import { useNow } from '@/hooks/use-now'
import { courseColor, courseLabel } from '@/modules/academics/color'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Alert, AlertTitle } from '@/ui/alert'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { announcementPath, postedLabel } from '../announcements'
import { useAnnouncements } from '../posts'

const LIMIT: Record<string, number> = { m: 4, l: 8 }

/**
 * Latest announcements from the LMS (M09 §6): the course's own, or on a term every linked
 * course's together, as the 公告 page lists them (unread ones with a dot and in bold). Titles open the
 * announcement on the 公告 page.
 */
export default function AnnouncementsCard({ scope, size }: CardProps) {
  const courseId = scope.kind === 'course' ? scope.courseId : undefined
  const { rows: all, linked, loading, failed } = useAnnouncements(scope)
  const rows = all.slice(0, LIMIT[size] ?? 8)
  const now = useNow()

  if (loading && rows.length === 0) return <CardSkeleton />
  if (failed && rows.length === 0) {
    return (
      <Alert variant="destructive">
        <CircleAlert aria-hidden />
        <AlertTitle>{m.common_load_failed()}</AlertTitle>
      </Alert>
    )
  }
  if (rows.length === 0) {
    return (
      <Empty className="border-0 p-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Megaphone aria-hidden />
          </EmptyMedia>
          <EmptyTitle>
            {linked ? m.lms_announcements_empty() : m.lms_announcements_unlinked()}
          </EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <ul className="space-y-1.5 text-sm">
      {rows.map(({ item, course }) => (
        <li key={`${course.id}:${item.external_id}`}>
          <Link
            to={announcementPath(scope, course.id, item.external_id)}
            className="flex items-center gap-2 rounded-lg hover:bg-muted/50"
          >
            <span className="flex w-2 shrink-0 justify-center">
              {item.unread ? (
                <span className="size-2 rounded-full bg-primary">
                  <span className="sr-only">{m.lms_announcements_unread()}</span>
                </span>
              ) : null}
            </span>
            {courseId ? null : (
              <span
                aria-hidden
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: courseColor(course) }}
              />
            )}
            <span className={cn('min-w-0 flex-1 truncate', item.unread && 'font-semibold')}>
              {item.title}
              {courseId ? null : (
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                  {courseLabel(course)}
                </span>
              )}
            </span>
            {item.posted_at ? (
              <span className="shrink-0 text-xs text-muted-foreground">
                {postedLabel(item.posted_at, now)}
              </span>
            ) : null}
          </Link>
        </li>
      ))}
    </ul>
  )
}
