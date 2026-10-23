import { type CourseOverview, lmsCourseRefresh } from '@semestra/api-client'
import { lmsCourseOverviewOptions } from '@semestra/api-client/react-query'
import { keepPreviousData, useIsFetching, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { useState } from 'react'
import type { PageProps } from '@/app/extensions'
import { toastError } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { LmsUpdatesBanner } from '@/modules/lms/components/LmsUpdatesBanner'
import { invalidateLms, isCourseContent } from '@/modules/lms/queries'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/select'
import { Skeleton } from '@/ui/skeleton'
import { CanvasBoundary, ListSkeleton } from './CanvasBoundary'
import { type CanvasPage, CanvasPageContext, useCanvasPage } from './context'
import { useCanvasLocation } from './location'
import {
  type CanvasLocation,
  type NavEntry,
  type Resolved,
  navEntries,
  resolveLocation,
} from './navigation'
import { AnnouncementsView } from './views/AnnouncementsView'
import { AssignmentsView } from './views/AssignmentsView'
import { OpenInCanvas } from './views/common'
import { FilePreviewDialog } from './views/FilePreview'
import { FilesView } from './views/FilesView'
import { GradesView } from './views/GradesView'
import { HomeView } from './views/HomeView'
import { ModulesView } from './views/ModulesView'
import { OtherTabView } from './views/OtherTabView'
import { PagesView } from './views/PagesView'
import { QuizzesView } from './views/QuizzesView'
import { SyllabusView } from './views/SyllabusView'

/**
 * The Canvas tab of a linked course (M16): the course menu as Canvas has it on the left (a menu
 * on narrow screens), the chosen view on the right. Everything comes from the M09 reads.
 */
export default function CanvasCoursePage({ scope }: PageProps) {
  if (scope.kind !== 'course') return null
  return <CanvasCourse programId={scope.programId} courseId={scope.courseId} />
}

function CanvasCourse({ programId, courseId }: { programId: string; courseId: string }) {
  const queryClient = useQueryClient()
  const [location, go] = useCanvasLocation(courseId)
  const [refreshing, setRefreshing] = useState(false)
  const [file, setFile] = useState<string | null>(null)
  const overview = useQuery({
    ...lmsCourseOverviewOptions({ path: { course_id: courseId } }),
    placeholderData: keepPreviousData,
  })
  const fetching = useIsFetching({ predicate: isCourseContent(courseId) }) > 0

  // "Refresh" drops this course's cached reads once on the server, then refetches them; later
  // reads use the cache again (M16 implementation notes).
  const reload = () => {
    setRefreshing(true)
    lmsCourseRefresh({ path: { course_id: courseId }, throwOnError: true })
      .then(() => invalidateLms(queryClient, { courseId }), toastError)
      .finally(() => setRefreshing(false))
  }

  const page: CanvasPage = { programId, courseId, go, openFile: setFile }

  return (
    <CanvasPageContext value={page}>
      <div className="space-y-4">
        <CanvasBoundary query={overview} skeleton={<PageSkeleton />}>
          {(data) => (
            <>
              <TopBar overview={data} fetching={fetching || refreshing} onRefresh={reload} />
              <LmsUpdatesBanner programId={programId} courseId={courseId} />
              <Body overview={data} location={location} />
            </>
          )}
        </CanvasBoundary>
      </div>
      <FilePreviewDialog fileId={file} onClose={() => setFile(null)} />
    </CanvasPageContext>
  )
}

function PageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="h-3.5 w-1/5" />
      </div>
      <ListSkeleton />
    </div>
  )
}

function TopBar({
  overview,
  fetching,
  onRefresh,
}: {
  overview: CourseOverview
  fetching: boolean
  onRefresh: () => void
}) {
  const course = overview.course
  const url = overview.link.web_url ?? course.web_url
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate font-medium">{course.name}</p>
        <p className="min-h-4 truncate text-xs text-muted-foreground">
          {[course.code, course.term].filter(Boolean).join(' · ')}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {url ? <OpenInCanvas href={url} /> : null}
        <Button variant="outline" size="sm" disabled={fetching} onClick={onRefresh}>
          <RefreshCw
            aria-hidden
            className={cn(fetching && 'animate-spin motion-reduce:animate-none')}
          />
          {m.canvas_tab_refresh()}
        </Button>
      </div>
    </div>
  )
}

function Body({ overview, location }: { overview: CourseOverview; location: CanvasLocation }) {
  const entries = navEntries(overview.navigation)
  const resolved = resolveLocation(location, entries)
  const activeKey = resolved.kind === 'native' ? resolved.view : resolved.entry.key
  return (
    <div className="gap-6 lg:grid lg:grid-cols-[12rem_minmax(0,1fr)]">
      <CourseNav entries={entries} activeKey={activeKey} />
      <section aria-label={resolved.entry?.label ?? m.canvas_tab_page_title()} className="min-w-0">
        <View overview={overview} resolved={resolved} />
      </section>
    </div>
  )
}

function View({ overview, resolved }: { overview: CourseOverview; resolved: Resolved }) {
  if (resolved.kind !== 'native') return <OtherTabView entry={resolved.entry} />
  switch (resolved.view) {
    case 'home':
      return <HomeView defaultView={overview.default_view ?? overview.course.default_view} />
    case 'announcements':
      return <AnnouncementsView selected={resolved.ref} />
    case 'assignments':
      return <AssignmentsView selected={resolved.ref} />
    case 'files':
      return <FilesView selected={resolved.ref} />
    case 'grades':
      return <GradesView />
    case 'modules':
      return <ModulesView selected={resolved.ref} />
    case 'pages':
      return <PagesView selected={resolved.ref} />
    case 'quizzes':
      return <QuizzesView selected={resolved.ref} />
    case 'syllabus':
      return <SyllabusView />
  }
}

/** Canvas's course menu: a sticky list on wide screens, a select on narrow ones (M16 §3). */
function CourseNav({ entries, activeKey }: { entries: NavEntry[]; activeKey: string }) {
  const { go } = useCanvasPage()
  const items = entries.map((e) => ({ value: e.key, label: e.label }))
  return (
    <>
      <div className="mb-4 lg:hidden">
        <Select
          value={activeKey}
          items={items}
          onValueChange={(next) => {
            if (typeof next === 'string') go({ tab: next })
          }}
        >
          <SelectTrigger aria-label={m.canvas_tab_nav_label()} className="w-full sm:w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {items.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <nav
        aria-label={m.canvas_tab_nav_label()}
        className="hidden self-start lg:sticky lg:top-4 lg:block"
      >
        <ul className="space-y-0.5">
          {entries.map((e) => (
            <li key={e.key}>
              <Button
                variant="ghost"
                size="sm"
                aria-current={e.key === activeKey ? 'page' : undefined}
                className="w-full justify-start font-normal aria-[current=page]:bg-muted aria-[current=page]:font-medium"
                onClick={() => go({ tab: e.key })}
              >
                <span className="truncate">{e.label}</span>
              </Button>
            </li>
          ))}
        </ul>
      </nav>
    </>
  )
}
