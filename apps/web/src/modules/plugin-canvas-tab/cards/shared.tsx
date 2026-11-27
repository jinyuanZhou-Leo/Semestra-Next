import type { CourseOverview, UnreadCounts } from '@semestra/api-client'
import { useQuery } from '@tanstack/react-query'
import { CircleAlert, School } from 'lucide-react'
import { cn } from '@/lib/utils'
import { coursePath } from '@/modules/academics/paths'
import { courseOverviewOptions } from '@/modules/lms/course-info'
import { m } from '@/paraglide/messages'
import { Alert, AlertTitle } from '@/ui/alert'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { type NavEntry, type NativeView, navEntries } from '../navigation'
import { programLinksOptions } from '../open-in-canvas'
import { unreadOptions } from './prefetch'

export type Native = Extract<NavEntry, { kind: 'native' }>

/** The tab's own views in the course's Canvas menu, in its order, without hidden ones. */
export const natives = (overview: CourseOverview) =>
  navEntries(overview.navigation).filter((e): e is Native => e.kind === 'native')

/** A view of the course's Canvas tab; without one, where the user left the tab. */
export function placePath(programId: string, courseId: string, view?: NativeView) {
  const base = coursePath(programId, courseId, 'canvas')
  return view ? `${base}?tab=${view}` : base
}

export function unreadOf(data: UnreadCounts | undefined, courseId: string) {
  return data?.items.find((c) => c.course_id === courseId)?.unread ?? 0
}

export type CourseCanvas =
  | { state: 'loading' | 'error' | 'unlinked' }
  | { state: 'ready'; overview: CourseOverview; unread: number }

/**
 * A course card's data: whether the course is linked to Canvas, then its menu. A failed read is
 * an error, never "not linked".
 */
export function useCourseCanvas(programId: string, courseId: string): CourseCanvas {
  const links = useQuery(programLinksOptions(programId))
  const linked =
    links.data?.items.some((l) => l.course_id === courseId && l.provider === 'canvas') ?? false
  const overview = useQuery({ ...courseOverviewOptions(courseId), enabled: linked })
  const unread = useQuery(unreadOptions(programId)).data
  if (links.isPending) return { state: 'loading' }
  if (!links.data) return { state: 'error' }
  if (!linked) return { state: 'unlinked' }
  if (overview.data) {
    return { state: 'ready', overview: overview.data, unread: unreadOf(unread, courseId) }
  }
  return { state: overview.isError ? 'error' : 'loading' }
}

/** A read the card needs failed (the platform's limits, a lost connection…). */
export function LoadFailed() {
  return (
    <Alert variant="destructive">
      <CircleAlert aria-hidden />
      <AlertTitle>{m.common_load_failed()}</AlertTitle>
    </Alert>
  )
}

/** The unread announcements on an icon: the count, as the page tabs show it. */
export function UnreadBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null
  return (
    <span
      className={cn(
        'absolute min-w-4 rounded-full bg-primary px-1 text-center text-[0.625rem] leading-4 text-primary-foreground tabular-nums',
        className,
      )}
    >
      {count}
      <span className="sr-only"> {m.lms_announcements_unread()}</span>
    </span>
  )
}

export function Unlinked({ term = false }: { term?: boolean }) {
  return (
    <Empty className="border-0 p-0">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <School aria-hidden />
        </EmptyMedia>
        <EmptyTitle>
          {term ? m.canvas_tab_card_unlinked_term() : m.canvas_tab_card_unlinked()}
        </EmptyTitle>
      </EmptyHeader>
    </Empty>
  )
}
