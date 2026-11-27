import type { Course, CourseOverview, UnreadCounts } from '@semestra/api-client'
import {
  academicsCourseListOptions,
  lmsAnnouncementUnreadOptions,
} from '@semestra/api-client/react-query'
import { useQueries, useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { School } from 'lucide-react'
import { CardSkeleton } from '@/app/board/CardSkeleton'
import type { CardProps } from '@/app/extensions'
import { courseColor, courseLabel } from '@/modules/academics/color'
import { coursePath } from '@/modules/academics/paths'
import { coursesOfTerm } from '@/modules/academics/queries'
import { courseOverviewOptions } from '@/modules/lms/course-info'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { NAV_ICONS } from '../icons'
import { type NavEntry, type NativeView, navEntries } from '../navigation'
import { programLinksOptions } from '../open-in-canvas'

/** The term card's columns, the same for every course so they line up. */
const SLOTS: NativeView[] = [
  'announcements',
  'syllabus',
  'modules',
  'assignments',
  'pages',
  'files',
]

type Native = Extract<NavEntry, { kind: 'native' }>

const natives = (overview: CourseOverview) =>
  navEntries(overview.navigation).filter((e): e is Native => e.kind === 'native')

function placePath(programId: string, courseId: string, view: NativeView) {
  return `${coursePath(programId, courseId, 'canvas')}?tab=${view}`
}

function unreadOf(data: UnreadCounts | undefined, courseId: string) {
  return data?.items.find((c) => c.course_id === courseId)?.unread ?? 0
}

/** The Canvas tab's views of a linked course, one click away (M16). */
export default function ShortcutsCard(props: CardProps) {
  return props.scope.kind === 'term' ? <TermShortcuts {...props} /> : <CourseShortcuts {...props} />
}

function CourseShortcuts({ scope }: CardProps) {
  const programId = scope.kind === 'course' ? scope.programId : ''
  const courseId = scope.kind === 'course' ? scope.courseId : ''
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
  const entries = natives(overview.data)
  const count = unreadOf(unread, courseId)
  return (
    <ul className="grid flex-1 grid-cols-4 content-center gap-1">
      {entries.map((entry) => {
        const Icon = NAV_ICONS[entry.key]
        const n = entry.key === 'announcements' ? count : 0
        return (
          <li key={entry.key} className="min-w-0">
            <Link
              to={placePath(programId, courseId, entry.key)}
              className="relative flex h-14 flex-col items-center justify-center gap-1.5 rounded-lg px-1 text-xs hover:bg-muted/50"
            >
              <span className="relative">
                <Icon aria-hidden className="size-5 text-muted-foreground" />
                {n > 0 ? (
                  <span className="absolute -top-1.5 -right-2.5 min-w-4 rounded-full bg-primary px-1 text-center text-[0.625rem] leading-4 text-primary-foreground tabular-nums">
                    {n}
                  </span>
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
  const programId = scope.programId
  const termId = scope.kind === 'term' ? scope.termId : ''
  const links = useQuery(programLinksOptions(programId))
  const courses = useQuery(
    academicsCourseListOptions({
      path: { program_id: programId },
      query: { limit: 500, term_id: termId },
    }),
  )
  const unread = useQuery(lmsAnnouncementUnreadOptions({ path: { program_id: programId } })).data
  const linkedIds = new Set(
    (links.data?.items ?? []).filter((l) => l.provider === 'canvas').map((l) => l.course_id),
  )
  const rows: Course[] = coursesOfTerm(courses.data?.items ?? [], termId).filter((c) =>
    linkedIds.has(c.id),
  )
  const overviews = useQueries({ queries: rows.map((c) => courseOverviewOptions(c.id)) })

  if (links.isPending || courses.isPending) return <CardSkeleton />
  if (rows.length === 0) {
    return (
      <Empty className="border-0 p-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <School aria-hidden />
          </EmptyMedia>
          <EmptyTitle>{m.canvas_tab_card_unlinked_term()}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <ul className="flex flex-col gap-0.5">
      {rows.map((course, index) => {
        const overview = overviews[index]?.data
        const count = unreadOf(unread, course.id)
        return (
          <li key={course.id} className="flex h-9 min-w-0 items-center gap-2">
            <Link
              to={coursePath(programId, course.id, 'canvas')}
              className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 text-sm hover:bg-muted/50"
            >
              <span
                aria-hidden
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: courseColor(course) }}
              />
              <span className="min-w-0 truncate">{courseLabel(course)}</span>
            </Link>
            <span className="flex shrink-0 items-center">
              {overview
                ? SLOTS.map((key) => {
                    const entry = natives(overview).find((e) => e.key === key)
                    if (!entry) return <span key={key} className="size-8" />
                    const Icon = NAV_ICONS[entry.key]
                    const dot = entry.key === 'announcements' && count > 0
                    return (
                      <Tooltip key={entry.key}>
                        <TooltipTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="relative text-muted-foreground"
                              aria-label={entry.label}
                              render={<Link to={placePath(programId, course.id, entry.key)} />}
                            />
                          }
                        >
                          <Icon aria-hidden />
                          {dot ? (
                            <span className="absolute top-1 right-1 size-1.5 rounded-full bg-primary" />
                          ) : null}
                        </TooltipTrigger>
                        <TooltipContent>
                          {dot ? `${entry.label} · ${count}` : entry.label}
                        </TooltipContent>
                      </Tooltip>
                    )
                  })
                : null}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
