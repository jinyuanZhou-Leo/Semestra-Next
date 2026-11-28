import { skipToken, useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ChevronLeft } from 'lucide-react'
import { type PageContribution, type Scope, scopePath } from '@/app/extensions'
import { PluginBoundary } from '@/app/host/PluginBoundary'
import { usePageStatuses } from '@/app/registry'
import { cn } from '@/lib/utils'
import { courseColor, courseLabel } from '@/modules/academics/color'
import { useCourse } from '@/modules/academics/queries'
import { m } from '@/paraglide/messages'
import { Skeleton } from '@/ui/skeleton'
import { DesktopOnly } from './MobileShell'
import { onPhone } from './phone'

/**
 * A course on a phone (M17 §4.1): its name, a segmented row of the course pages that have a
 * phone version (`PageContribution.mobile` in the course scope), and the open one under them.
 * The course's own address opens the first segment; a course page without a phone version asks
 * for a computer. `back` is the tab the courses are listed on.
 */
export function MobileCourse({
  programId,
  courseId,
  pageId,
  back,
  home,
}: {
  programId: string
  courseId: string
  pageId: string | undefined
  back: PageContribution | undefined
  home: PageContribution | undefined
}) {
  const scope: Scope = { kind: 'course', programId, courseId }
  const course = useCourse(courseId).data
  const statuses = usePageStatuses(scope)
  const pages = statuses
    .filter((entry) => entry.status === 'available' && onPhone(entry.page, scope))
    .map((entry) => entry.page)
  const settled = statuses.every((entry) => entry.status !== 'pending')
  const page = pageId === undefined ? pages[0] : pages.find((p) => p.id === pageId)
  const Page = page?.mobile?.component
  if (!Page && settled && pageId !== undefined) {
    return <DesktopOnly programId={programId} home={home} />
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain pb-6 *:shrink-0">
      <header className="px-5 pt-[max(env(safe-area-inset-top),1rem)] pb-3">
        {back ? (
          <Link
            to="/p/$programId/$page"
            params={{ programId, page: back.id }}
            className="-ml-1.5 flex h-9 w-fit items-center text-sm font-medium text-primary"
          >
            <ChevronLeft aria-hidden className="size-5" />
            {(back.mobile?.tab?.title ?? back.title)()}
          </Link>
        ) : null}
        {course ? (
          <>
            <h1 className="mt-1 flex items-center gap-2.5 font-heading text-3xl font-semibold tracking-tight">
              <span
                aria-hidden
                className="size-3 shrink-0 rounded-full"
                style={{ backgroundColor: courseColor(course) }}
              />
              <span className="truncate">{courseLabel(course)}</span>
            </h1>
            <p className="mt-0.5 min-h-5 truncate text-sm text-muted-foreground">
              {course.title !== courseLabel(course) ? course.title : course.code}
            </p>
          </>
        ) : (
          <>
            <Skeleton className="mt-2 h-8 w-40" />
            <Skeleton className="mt-1.5 h-4 w-56" />
          </>
        )}
      </header>
      {pages.length > 1 ? (
        <nav
          aria-label={m.mobile_course_pages()}
          className="mx-4 flex gap-0.5 rounded-full bg-muted p-0.5"
        >
          {pages.map((p) => {
            const active = p.id === page?.id
            return (
              <Link
                key={p.id}
                to={scopePath(scope, p.id)}
                replace
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-8 min-w-0 flex-1 items-center justify-center gap-1 rounded-full px-2 text-sm font-medium text-muted-foreground',
                  active && 'bg-background text-foreground shadow-sm dark:bg-input',
                )}
              >
                <span className="truncate">{p.title()}</span>
                <Unread page={p} scope={scope} />
              </Link>
            )
          })}
        </nav>
      ) : null}
      {Page && page ? (
        <PluginBoundary key={page.id}>
          <Page scope={scope} />
        </PluginBoundary>
      ) : null}
    </div>
  )
}

/** How many things wait on a segment (unread announcements); nothing at zero. */
function Unread({ page, scope }: { page: PageContribution; scope: Scope }) {
  const options = page.unread?.query(scope)
  const data = useQuery(
    options ?? { queryKey: ['mobile.unread', page.id], queryFn: skipToken },
  ).data
  const n = data === undefined || !page.unread ? 0 : page.unread.count(scope, data)
  if (n === 0) return null
  return (
    <span className="rounded-full bg-primary/10 px-1.5 text-xs leading-5 font-medium text-primary tabular-nums">
      <span aria-hidden>{n}</span>
      <span className="sr-only">{m.host_nav_unread({ count: n })}</span>
    </span>
  )
}
