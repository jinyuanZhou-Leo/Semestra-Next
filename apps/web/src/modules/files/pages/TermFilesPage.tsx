import type { Course, FilesItemList, ItemOut } from '@semestra/api-client'
import { type UseQueryResult, useQueries } from '@tanstack/react-query'
import {
  ArrowRight,
  BookOpen,
  ChevronDown,
  CircleAlert,
  FolderOpen,
  Search,
  Upload,
} from 'lucide-react'
import { type DragEvent, useRef, useState } from 'react'
import type { PageProps } from '@/app/extensions'
import { useUiPref } from '@/app/ui-pref'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { HistoryLink } from '@/components/HistoryLink'
import { courseColor, courseLabel } from '@/modules/academics/color'
import { coursePath } from '@/modules/academics/paths'
import { coursesOfTerm, useCourses } from '@/modules/academics/queries'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Alert, AlertDescription } from '@/ui/alert'
import { Button } from '@/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/ui/input-group'
import { Skeleton } from '@/ui/skeleton'
import { useExternalLink } from '../components/ExternalLink'
import { FileBrowser, SortMenu } from '../components/FileBrowser'
import { type ItemAction, ItemDialogs } from '../components/ItemDialogs'
import { PreviewDialog, type PreviewTarget } from '../components/PreviewDialog'
import { SearchResults, useContentSearch } from '../components/SearchResults'
import { useUploads } from '../components/Uploads'
import { UsageBar } from '../components/UsageBar'
import { searchTerms } from '../highlight'
import { useDebounced, useFileDrop } from '../hooks'
import { courseFilesOptions } from '../queries'

const NOOP = () => {}

/**
 * The `files` page of a term (M07 §6.2): each course's files in its own section, search across
 * them, and uploads into a course picked from the menu or by dropping on its section.
 */
export default function TermFilesPage({ scope }: PageProps) {
  const termId = scope.kind === 'term' ? scope.termId : ''
  return (
    <AsyncBoundary query={useCourses(scope.programId, termId)}>
      {(list) => (
        <TermFiles
          key={termId}
          programId={scope.programId}
          termId={termId}
          courses={coursesOfTerm(list.items, termId)}
        />
      )}
    </AsyncBoundary>
  )
}

function TermFiles({
  programId,
  termId,
  courses,
}: {
  programId: string
  termId: string
  courses: Course[]
}) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [search, setSearch] = useState('')
  const [preview, setPreview] = useState<PreviewTarget | null>(null)
  const [action, setAction] = useState<{ courseId: string; action: ItemAction } | null>(null)
  // The course the file picker uploads to, and the section dragged files are over.
  const [pickFor, setPickFor] = useState<string | null>(null)
  const [dropCourseId, setDropCourseId] = useState<string | null>(null)
  const [view] = useUiPref<'list' | 'grid'>('files.view', 'list')
  const link = useExternalLink()
  const uploads = useUploads()
  // Files dropped outside every section have no course to go to.
  const dragging = useFileDrop(NOOP)
  const query = useDebounced(search, 300)
  const contentSearch = useContentSearch(programId, query, { termId })
  const lists = useQueries({ queries: courses.map((course) => courseFilesOptions(course.id)) })

  if (courses.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <BookOpen aria-hidden />
          </EmptyMedia>
          <EmptyTitle>{m.files_term_no_courses()}</EmptyTitle>
          <EmptyDescription>{m.files_term_no_courses_description()}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  const open = (item: ItemOut) => {
    if (item.kind === 'link' && item.url) link.open(item.url)
    else setPreview({ itemId: item.id })
  }
  const byCourse = new Map(courses.map((c) => [c.id, c]))
  const listOf = (courseId: string) => lists[courses.findIndex((c) => c.id === courseId)]?.data
  const upload = (courseId: string, files: readonly File[]) =>
    uploads.start(files, {
      courseId,
      folderId: null,
      existing: listOf(courseId)?.items ?? [],
    })
  const allItems = lists.flatMap((q) => q.data?.items ?? [])
  const needle = search.trim().toLowerCase()
  const searching = needle.length > 0
  const acting = action ? listOf(action.courseId) : undefined

  return (
    <div className="flex flex-col gap-3">
      <div className="flex min-h-9 items-center gap-2">
        <InputGroup className="w-72">
          <InputGroupInput
            type="search"
            aria-label={m.files_search_term()}
            placeholder={m.files_search_term()}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <InputGroupAddon>
            <Search aria-hidden />
          </InputGroupAddon>
        </InputGroup>
        <div className="ml-auto flex items-center gap-2">
          {view === 'grid' && !searching ? <SortMenu /> : null}
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button />}>
              <Upload aria-hidden />
              {m.files_upload()}
              <ChevronDown aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {courses.map((course) => (
                <DropdownMenuItem
                  key={course.id}
                  onClick={() => {
                    setPickFor(course.id)
                    fileInput.current?.click()
                  }}
                >
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: courseColor(course) }}
                  />
                  {m.files_upload_to({ course: courseLabel(course) })}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            aria-hidden
            tabIndex={-1}
            onChange={(event) => {
              if (pickFor) upload(pickFor, [...(event.target.files ?? [])])
              event.target.value = ''
            }}
          />
        </div>
      </div>

      {searching ? (
        <SearchResults
          nameMatches={allItems.filter((i) => i.display_name.toLowerCase().includes(needle))}
          hits={contentSearch.data?.results ?? []}
          loading={query.trim().length >= 2 && (contentSearch.isFetching || search !== query)}
          pendingNames={(contentSearch.data?.pending_items ?? []).map((p) => p.display_name)}
          courseName={(id) => {
            const course = byCourse.get(id)
            return course ? courseLabel(course) : ''
          }}
          onOpenItem={open}
          onOpenHit={(hit) =>
            setPreview({ itemId: hit.item_id, page: hit.page_from, terms: searchTerms(query) })
          }
          onClear={() => setSearch('')}
        />
      ) : (
        <div className="space-y-6">
          {courses.map((course, index) => (
            <CourseSection
              key={course.id}
              course={course}
              list={lists[index]}
              view={view}
              programId={programId}
              dragging={dragging}
              over={dropCourseId === course.id}
              onOver={setDropCourseId}
              onDrop={(files) => upload(course.id, files)}
              open={open}
              act={(next) => setAction({ courseId: course.id, action: next })}
            />
          ))}
        </div>
      )}

      <UsageBar />

      {uploads.panel}
      {uploads.dialog}
      {link.dialog}
      {acting ? (
        <ItemDialogs
          courseId={action?.courseId ?? ''}
          folders={acting.folders}
          items={acting.items}
          action={action?.action ?? null}
          onClose={() => setAction(null)}
        />
      ) : null}
      <PreviewDialog target={preview} onClose={() => setPreview(null)} />
    </div>
  )
}

function hasFiles(event: DragEvent) {
  return event.dataTransfer.types.includes('Files')
}

/** One course's files; while files are dragged over the page, also where they can be dropped. */
function CourseSection({
  course,
  list,
  view,
  programId,
  dragging,
  over,
  onOver,
  onDrop,
  open,
  act,
}: {
  course: Course
  list: UseQueryResult<FilesItemList> | undefined
  view: 'list' | 'grid'
  programId: string
  dragging: boolean
  over: boolean
  onOver: (courseId: string | null) => void
  onDrop: (files: File[]) => void
  open: (item: ItemOut) => void
  act: (action: ItemAction) => void
}) {
  const items = list?.data?.items
  const name = courseLabel(course)
  return (
    <section
      className="relative space-y-2"
      onDragOver={(event) => {
        if (!hasFiles(event)) return
        event.preventDefault()
        onOver(course.id)
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onOver(null)
      }}
      onDrop={(event) => {
        if (!hasFiles(event)) return
        // Taken here: the page's drop zone leaves it alone (`useFileDrop`).
        event.preventDefault()
        onOver(null)
        onDrop([...event.dataTransfer.files])
      }}
    >
      <div className="flex h-8 items-center gap-2">
        <span
          aria-hidden
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: courseColor(course) }}
        />
        <h2 className="min-w-0 truncate text-sm font-medium">{name}</h2>
        <Button
          nativeButton={false}
          variant="ghost"
          size="sm"
          className="ml-auto text-muted-foreground"
          render={<HistoryLink href={coursePath(programId, course.id, 'files')} />}
        >
          {m.files_open_course_files()}
          <ArrowRight aria-hidden />
        </Button>
      </div>
      {items?.length === 0 ? (
        <Empty className="rounded-2xl border border-solid border-border p-6">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderOpen aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{m.files_term_course_empty_title()}</EmptyTitle>
            <EmptyDescription>{m.files_term_course_empty_description()}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : items ? (
        <FileBrowser
          folders={[]}
          items={items}
          view={view}
          handlers={{ open, openFolder: NOOP, act, programId }}
        />
      ) : list?.isError ? (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription>{errorMessage(list.error)}</AlertDescription>
        </Alert>
      ) : (
        <Skeleton className="h-24 w-full rounded-2xl" />
      )}
      {dragging ? (
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute -inset-2 z-20 flex items-center justify-center gap-2 rounded-3xl border-2 border-dashed text-sm font-medium backdrop-blur-sm',
            over
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border bg-background/80 text-muted-foreground',
          )}
        >
          <Upload aria-hidden className="size-4" />
          {over ? m.files_drop_here({ folder: name }) : m.files_drop_on_course({ course: name })}
        </div>
      ) : null}
    </section>
  )
}
