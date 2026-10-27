import { type CourseOverview, lmsCourseRefresh } from '@semestra/api-client'
import { lmsCourseOverviewOptions } from '@semestra/api-client/react-query'
import { keepPreviousData, useIsFetching, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowUpRight,
  ClipboardList,
  FileText,
  Folder,
  GraduationCap,
  House,
  Layers,
  ListChecks,
  type LucideIcon,
  Megaphone,
  RefreshCw,
  ScrollText,
} from 'lucide-react'
import { useState } from 'react'
import type { PageProps } from '@/app/extensions'
import { toastError } from '@/lib/errors'
import { formatTimeAgo } from '@/lib/format'
import { useNow } from '@/lib/now'
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
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/ui/select'
import { Skeleton } from '@/ui/skeleton'
import { CanvasBoundary, ListSkeleton } from './CanvasBoundary'
import { type CanvasPage, CanvasPageContext, useCanvasPage } from './context'
import { useCanvasLocation } from './location'
import { openExternal } from './open-in-canvas'
import {
  type CanvasLocation,
  type NativeView,
  type NavEntry,
  type Resolved,
  navEntries,
  resolveLocation,
} from './navigation'
import { AnnouncementsView } from './views/AnnouncementsView'
import { AssignmentsView } from './views/AssignmentsView'
import { IconAction, OpenInCanvasIcon } from './views/common'
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
      <div className="flex flex-col gap-4">
        <CanvasBoundary query={overview} skeleton={<PageSkeleton />}>
          {(data) => (
            <>
              <LmsUpdatesBanner programId={programId} courseId={courseId} />
              <Body
                overview={data}
                location={location}
                fetching={fetching || refreshing}
                onRefresh={reload}
              />
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
    <div className="gap-6 xl:grid xl:grid-cols-[12rem_minmax(0,1fr)]">
      <div className="hidden space-y-2 xl:block">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-7 w-full" />
        ))}
      </div>
      <ListSkeleton />
    </div>
  )
}

type Sync = { fetching: boolean; onRefresh: () => void }

function Body({
  overview,
  location,
  fetching,
  onRefresh,
}: { overview: CourseOverview; location: CanvasLocation } & Sync) {
  const entries = navEntries(overview.navigation)
  const resolved = resolveLocation(location, entries)
  const activeKey = resolved.kind === 'native' ? resolved.view : resolved.entry.key
  return (
    <div className="flex flex-1 flex-col gap-4 xl:grid xl:grid-cols-[12rem_minmax(0,1fr)] xl:gap-6">
      <CourseNav
        overview={overview}
        entries={entries}
        activeKey={activeKey}
        fetching={fetching}
        onRefresh={onRefresh}
      />
      <section
        aria-label={resolved.entry?.label ?? m.canvas_tab_page_title()}
        className="flex min-w-0 flex-1 flex-col"
      >
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

const NAV_ICONS: Record<NativeView, LucideIcon> = {
  home: House,
  announcements: Megaphone,
  syllabus: ScrollText,
  modules: Layers,
  assignments: ClipboardList,
  quizzes: ListChecks,
  grades: GraduationCap,
  pages: FileText,
  files: Folder,
}

/** When the course was read from Canvas: "Updated just now", "Updated 3 minutes ago". */
function fetchedLabel(at: string, now: number): string {
  return now - new Date(at).getTime() < 60_000
    ? m.canvas_tab_fetched_just_now()
    : m.canvas_tab_fetched_at({ time: formatTimeAgo(at, now) })
}

/** "Updated 3 minutes ago" (kept current while the page stays open), refresh and "Open in
 * Canvas" (M16 §3). */
function SyncControls({ overview, fetching, onRefresh }: { overview: CourseOverview } & Sync) {
  const url = overview.link.web_url ?? overview.course.web_url
  const now = useNow(30_000)
  const at = overview.fetched_at
  return (
    <div className="flex min-w-0 items-center gap-0.5">
      <span className="line-clamp-2 min-w-0 flex-1 text-xs text-muted-foreground">
        {at ? <time dateTime={at}>{fetchedLabel(at, now)}</time> : null}
      </span>
      <IconAction label={m.canvas_tab_refresh()} disabled={fetching} onClick={onRefresh}>
        <RefreshCw
          aria-hidden
          className={cn(fetching && 'animate-spin motion-reduce:animate-none')}
        />
      </IconAction>
      {url ? <OpenInCanvasIcon href={url} /> : null}
    </div>
  )
}

/**
 * Canvas's course menu (M16 §3): on wide screens a sticky column with the course on top, the
 * app's own views, the tabs that only open in Canvas, and the refresh controls at the bottom; on
 * narrow screens a select with the controls next to it.
 */
function CourseNav({
  overview,
  entries,
  activeKey,
  fetching,
  onRefresh,
}: {
  overview: CourseOverview
  entries: NavEntry[]
  activeKey: string
} & Sync) {
  const { go } = useCanvasPage()
  const course = overview.course
  const native = entries.filter((e) => e.kind === 'native')
  // Tabs the app can't show open straight in Canvas; without an address they show a note here.
  const elsewhere = entries.filter((e) => e.kind !== 'native')
  const items = entries.map((e) => ({ value: e.key, label: e.label }))
  const pick = (key: string) => {
    const entry = entries.find((e) => e.key === key)
    if (entry && entry.kind !== 'native' && entry.tab.web_url) openExternal(entry.tab.web_url)
    else go({ tab: key })
  }
  const courseMeta = [course.code, course.term].filter(Boolean).join(' · ')
  return (
    <>
      <div className="flex items-center gap-2 xl:hidden">
        <Select
          value={activeKey}
          items={items}
          onValueChange={(next) => {
            if (typeof next === 'string') pick(next)
          }}
        >
          <SelectTrigger aria-label={m.canvas_tab_nav_label()} className="w-full sm:w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {native.map((e) => (
                <SelectItem key={e.key} value={e.key}>
                  {e.label}
                </SelectItem>
              ))}
            </SelectGroup>
            {elsewhere.length > 0 ? (
              <>
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel>{m.canvas_tab_open_in_canvas()}</SelectLabel>
                  {elsewhere.map((e) => (
                    <SelectItem key={e.key} value={e.key}>
                      {e.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </>
            ) : null}
          </SelectContent>
        </Select>
        <div className="ml-auto shrink-0 sm:min-w-48">
          <SyncControls overview={overview} fetching={fetching} onRefresh={onRefresh} />
        </div>
      </div>
      <nav
        aria-label={m.canvas_tab_nav_label()}
        className="hidden flex-col gap-3 self-start xl:sticky xl:top-4 xl:flex"
      >
        <div className="px-2">
          <p className="text-xs font-medium text-muted-foreground">{m.canvas_tab_page_title()}</p>
          {courseMeta ? (
            <p className="line-clamp-2 text-xs text-muted-foreground" title={courseMeta}>
              {courseMeta}
            </p>
          ) : null}
        </div>
        <ul className="space-y-0.5">
          {native.map((e) => {
            const Icon = NAV_ICONS[e.key as NativeView]
            return (
              <li key={e.key}>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-current={e.key === activeKey ? 'page' : undefined}
                  className={NAV_ROW}
                  onClick={() => go({ tab: e.key })}
                >
                  <Icon aria-hidden className="text-muted-foreground" />
                  <span className="truncate">{e.label}</span>
                </Button>
              </li>
            )
          })}
        </ul>
        {elsewhere.length > 0 ? (
          <div className="space-y-1 border-t pt-3">
            <p className="px-2 text-xs text-muted-foreground">{m.canvas_tab_open_in_canvas()}</p>
            <ul className="space-y-0.5">
              {elsewhere.map((e) => (
                <li key={e.key}>
                  {e.tab.web_url ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className={NAV_ROW}
                      nativeButton={false}
                      // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- the children label it
                      render={<a href={e.tab.web_url} target="_blank" rel="noopener noreferrer" />}
                    >
                      <ArrowUpRight aria-hidden className="text-muted-foreground" />
                      <span className="truncate">{e.label}</span>
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-current={e.key === activeKey ? 'page' : undefined}
                      className={NAV_ROW}
                      onClick={() => go({ tab: e.key })}
                    >
                      <ArrowUpRight aria-hidden className="text-muted-foreground" />
                      <span className="truncate">{e.label}</span>
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="border-t px-2 pt-2">
          <SyncControls overview={overview} fetching={fetching} onRefresh={onRefresh} />
        </div>
      </nav>
    </>
  )
}

const NAV_ROW =
  'w-full justify-start font-normal aria-[current=page]:bg-muted aria-[current=page]:font-medium'
