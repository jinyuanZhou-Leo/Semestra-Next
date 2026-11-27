import type { Course } from '@semestra/api-client'
import { academicsCourseListOptions } from '@semestra/api-client/react-query'
import { useQueries, useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { CircleAlert } from 'lucide-react'
import { CardSkeleton } from '@/app/board/CardSkeleton'
import type { CardProps } from '@/app/extensions'
import { courseColor, courseLabel } from '@/modules/academics/color'
import { coursesOfTerm } from '@/modules/academics/queries'
import { courseOverviewOptions } from '@/modules/lms/course-info'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Skeleton } from '@/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { NAV_ICONS } from '../icons'
import type { NativeView } from '../navigation'
import { termLinksOptions, unreadOptions } from './prefetch'
import {
  LoadFailed,
  type Native,
  natives,
  placePath,
  UnreadBadge,
  Unlinked,
  unreadOf,
  useCourseCanvas,
} from './shared'

/**
 * The term card's columns, the same for every course so they line up (Canvas's dashboard cards do
 * the same); a course without one of them leaves its place empty.
 */
const SLOTS: readonly NativeView[] = [
  'announcements',
  'syllabus',
  'modules',
  'assignments',
  'pages',
  'files',
]

/**
 * The Canvas tab's views one click away (M16 §6): on a course, its Canvas menu as tiles; on a term,
 * a row per linked course.
 */
export default function ShortcutsCard(props: CardProps) {
  return props.scope.kind === 'term' ? <TermShortcuts {...props} /> : <CourseShortcuts {...props} />
}

function CourseShortcuts({ scope }: CardProps) {
  const courseId = scope.kind === 'course' ? scope.courseId : ''
  const canvas = useCourseCanvas(scope.programId, courseId)
  if (canvas.state === 'loading') return <CardSkeleton />
  if (canvas.state !== 'ready') return canvas.state === 'error' ? <LoadFailed /> : <Unlinked />
  const { overview, unread } = canvas
  return (
    <ul className="grid flex-1 scroll-fade grid-cols-4 content-center gap-1 overflow-y-auto">
      {natives(overview).map((entry) => {
        const Icon = NAV_ICONS[entry.key]
        return (
          <li key={entry.key} className="min-w-0">
            <Link
              to={placePath(scope.programId, courseId, entry.key)}
              className="flex h-14 flex-col items-center justify-center gap-1.5 rounded-lg px-1 text-xs transition-colors hover:bg-muted/50"
            >
              <span className="relative">
                <Icon aria-hidden className="size-5 text-muted-foreground" />
                {entry.key === 'announcements' ? (
                  <UnreadBadge count={unread} className="-top-1.5 -right-2.5" />
                ) : null}
              </span>
              <span className="w-full truncate text-center">{entry.label}</span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

function TermShortcuts({ scope }: CardProps) {
  const { programId } = scope
  const termId = scope.kind === 'term' ? scope.termId : ''
  const links = useQuery(termLinksOptions(programId, termId))
  const courses = useQuery(
    academicsCourseListOptions({
      path: { program_id: programId },
      query: { limit: 500, term_id: termId },
    }),
  )
  const unreadCounts = useQuery(unreadOptions(programId)).data
  const linked = new Set(
    (links.data?.items ?? []).filter((l) => l.provider === 'canvas').map((l) => l.course_id),
  )
  const rows: Course[] = coursesOfTerm(courses.data?.items ?? [], termId).filter((c) =>
    linked.has(c.id),
  )
  const overviews = useQueries({ queries: rows.map((c) => courseOverviewOptions(c.id)) })

  if (links.isPending || courses.isPending) return <CardSkeleton />
  if (!links.data || !courses.data) return <LoadFailed />
  if (rows.length === 0) return <Unlinked term />
  return (
    <ul className="flex min-h-0 flex-1 scroll-fade flex-col gap-0.5 overflow-y-auto">
      {rows.map((course, index) => {
        const menu = overviews[index]
        const entries = menu?.data ? natives(menu.data) : null
        const unread = unreadOf(unreadCounts, course.id) > 0
        return (
          <li key={course.id} className="flex h-9 shrink-0 items-center gap-2">
            <Link
              to={placePath(programId, course.id)}
              className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 text-sm transition-colors hover:bg-muted/50"
            >
              <span
                aria-hidden
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: courseColor(course) }}
              />
              <span className="min-w-0 truncate">{courseLabel(course)}</span>
            </Link>
            <RowPlaces
              entries={entries}
              failed={menu?.isError ?? false}
              unread={unread}
              path={(view) => placePath(programId, course.id, view)}
              label={courseLabel(course)}
            />
          </li>
        )
      })}
    </ul>
  )
}

/**
 * A term row's six places. They are always there, so the columns never move: a view the course
 * lacks is an empty place, one still loading a placeholder; when its menu can't be read, the row
 * says so instead.
 */
function RowPlaces({
  entries,
  failed,
  unread,
  path,
  label,
}: {
  entries: Native[] | null
  failed: boolean
  unread: boolean
  path: (view: NativeView) => string
  label: string
}) {
  if (!entries && failed) {
    return (
      <span className="flex w-48 shrink-0 items-center justify-end gap-1.5 pr-2 text-xs text-muted-foreground">
        <CircleAlert aria-hidden className="size-3.5" />
        {m.common_load_failed()}
      </span>
    )
  }
  return (
    <span className="flex shrink-0 items-center">
      {SLOTS.map((key) => {
        if (!entries) {
          return (
            <span key={key} className="flex size-8 items-center justify-center">
              <Skeleton className="size-4 rounded" />
            </span>
          )
        }
        const entry = entries.find((e) => e.key === key)
        if (!entry) return <span key={key} aria-hidden className="size-8" />
        const Icon = NAV_ICONS[key]
        const dot = key === 'announcements' && unread
        return (
          <Tooltip key={key}>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="relative text-muted-foreground"
                  aria-label={`${label} · ${entry.label}`}
                  render={<Link to={path(key)} />}
                />
              }
            >
              <Icon aria-hidden />
              {dot ? (
                <span className="absolute top-1 right-1 size-1.5 rounded-full bg-primary">
                  <span className="sr-only">{m.lms_announcements_unread()}</span>
                </span>
              ) : null}
            </TooltipTrigger>
            <TooltipContent>{entry.label}</TooltipContent>
          </Tooltip>
        )
      })}
    </span>
  )
}
