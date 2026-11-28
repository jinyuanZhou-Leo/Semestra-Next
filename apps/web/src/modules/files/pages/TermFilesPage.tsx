import type { Course, FilesItemList, ItemOut } from '@semestra/api-client'
import { clearOnEscape, clearSearch } from '@/lib/search-input'
import { type UseQueryResult, useQueries } from '@tanstack/react-query'
import {
  type CellContext,
  FlexRender,
  createColumnHelper,
  tableFeatures,
  useTable,
} from '@tanstack/react-table'
import { BookOpen, Folder, Search, Upload, X } from 'lucide-react'
import { createContext, use, useEffect, useState } from 'react'
import type { PageProps } from '@/app/extensions'
import { useUiPref } from '@/app/ui-pref'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { FileDropOverlay } from '@/components/FileDropOverlay'
import { courseColor, courseLabel } from '@/modules/academics/color'
import { coursesOfTerm, useCourses } from '@/modules/academics/queries'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage } from '@/ui/breadcrumb'
import { Button } from '@/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/ui/input-group'
import { Skeleton } from '@/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { useExternalLink } from '@/components/ExternalLink'
import { ViewToggle } from '../components/FileBrowser'
import { PreviewDialog } from '../components/PreviewDialog'
import { SearchResults, useContentSearch } from '../components/SearchResults'
import { type Uploads, useUploads } from '../components/Uploads'
import { UsageBar } from '../components/UsageBar'
import { searchTerms } from '../highlight'
import { matchNames } from '../search-names'
import { useDebounced } from '@/hooks/use-debounced'
import { useFileDrop } from '@/lib/file-drop'
import { DROP_TARGET, type DropTargets, dropTargetProps } from '../hooks'
import { FilesNavBar, FilesNavProvider } from '../components/FilesNav'
import { type FilesLocation, useFilesLocation, usePreviewLocation } from '../location'
import { courseFilesOptions, useCourseFiles } from '../queries'
import { CourseFiles } from './CourseFilesPage'

const NOOP = () => {}

/**
 * The `files` page of a term (M07 §6.2): every course of the term is a folder. Opening one shows
 * that course's files as on its own page; at the top level the search covers the whole term and
 * files dropped on a course go into it.
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
  const location = useFilesLocation()
  // One upload queue for the whole page: its panel and duplicate question stay up when the
  // student opens a course or goes back to the courses mid-upload.
  const uploads = useUploads()
  // The course may have left the term (here or in another tab): back to the courses.
  const course = courses.find((c) => c.id === location.course)
  const courseGone = location.course !== null && !course
  useEffect(() => {
    if (courseGone) location.go({ course: null, folder: null, file: null }, { replace: true })
  }, [courseGone, location])

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
  return (
    <FilesNavProvider>
      {course ? (
        <OpenCourse
          key={course.id}
          course={course}
          programId={programId}
          uploads={uploads}
          back={() => location.go({ course: null, folder: null, file: null })}
        />
      ) : (
        <CourseFolders
          courses={courses}
          programId={programId}
          termId={termId}
          uploads={uploads}
          location={location}
        />
      )}
      {uploads.panel}
      {uploads.dialog}
    </FilesNavProvider>
  )
}

function OpenCourse({
  course,
  programId,
  uploads,
  back,
}: {
  course: Course
  programId: string
  uploads: Uploads
  back: () => void
}) {
  return (
    <AsyncBoundary query={useCourseFiles(course.id)}>
      {(list) => (
        <CourseFiles
          list={list}
          courseId={course.id}
          programId={programId}
          name={courseLabel(course)}
          up={{ label: m.files_all_courses(), onClick: back }}
          uploads={uploads}
        />
      )}
    </AsyncBoundary>
  )
}

type Folder = {
  course: Course
  list: UseQueryResult<FilesItemList> | undefined
}

/** Course folders open on click and take files dragged onto them (keyed by course id). */
type FolderHandlers = DropTargets & { open: (courseId: string) => void }

const HandlersContext = createContext<FolderHandlers | null>(null)

function useFolderHandlers() {
  const handlers = use(HandlersContext)
  if (!handlers) throw new Error('Course folders must render inside CourseFolders')
  return handlers
}

function lastChange(items: readonly ItemOut[]) {
  return items.reduce<string | null>(
    (latest, item) => (latest === null || item.updated_at > latest ? item.updated_at : latest),
    null,
  )
}

const features = tableFeatures({})
const column = createColumnHelper<typeof features, Folder>()
type CellProps = CellContext<typeof features, Folder>

function NameCell({ row }: CellProps) {
  const { open } = useFolderHandlers()
  const { course } = row.original
  return (
    <button
      type="button"
      onClick={() => open(course.id)}
      className="flex max-w-full items-center gap-2.5 text-left font-medium hover:underline"
    >
      <Folder
        aria-hidden
        className="size-4 shrink-0"
        style={{ color: courseColor(course) }}
        fill="currentColor"
        fillOpacity={0.2}
      />
      <span className="truncate">{courseLabel(course)}</span>
    </button>
  )
}

function CountCell({ row }: CellProps) {
  const items = row.original.list?.data?.items
  return items ? (
    <span className="text-muted-foreground tabular-nums">{items.length}</span>
  ) : (
    <Skeleton className="h-4 w-12" />
  )
}

function UpdatedCell({ row }: CellProps) {
  const items = row.original.list?.data?.items
  if (!items) return <Skeleton className="h-4 w-28" />
  const latest = lastChange(items)
  return latest ? (
    <span className="text-muted-foreground">{formatDateTime(latest)}</span>
  ) : (
    <span className="text-muted-foreground">—</span>
  )
}

const columns = column.columns([
  column.display({ id: 'name', header: () => m.files_name(), cell: NameCell }),
  column.display({ id: 'count', header: () => m.files_files(), cell: CountCell }),
  column.display({ id: 'updated', header: () => m.files_modified(), cell: UpdatedCell }),
])

const WIDTHS: Record<string, string> = { count: 'w-24', updated: 'w-44' }

function FolderTable({ folders }: { folders: Folder[] }) {
  const handlers = useFolderHandlers()
  const table = useTable({
    features,
    columns,
    data: folders,
    getRowId: (folder) => folder.course.id,
  })
  return (
    <div className="overflow-hidden rounded-2xl border">
      <Table className="min-w-2xl table-fixed">
        <TableHeader className="bg-muted/50">
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id} className="hover:bg-transparent">
              {group.headers.map((h) => (
                <TableHead
                  key={h.id}
                  className={cn('h-auto py-2 text-muted-foreground', WIDTHS[h.column.id])}
                >
                  <FlexRender header={h} />
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id} {...dropTargetProps(row.id, handlers)} className={DROP_TARGET}>
              {row.getAllCells().map((cell) => (
                <TableCell key={cell.id} className={cn('h-12 py-2', WIDTHS[cell.column.id])}>
                  <FlexRender cell={cell} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function FolderTile({ folder }: { folder: Folder }) {
  const handlers = useFolderHandlers()
  const { course } = folder
  return (
    <div
      {...dropTargetProps(course.id, handlers)}
      className={cn(
        'relative flex h-14 items-center gap-2.5 rounded-xl border bg-card px-3 hover:bg-muted/50',
        DROP_TARGET,
        'data-drop-target:border-primary',
      )}
    >
      <button
        type="button"
        onClick={() => handlers.open(course.id)}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left text-sm after:absolute after:inset-0"
      >
        <Folder
          aria-hidden
          className="size-4 shrink-0"
          style={{ color: courseColor(course) }}
          fill="currentColor"
          fillOpacity={0.2}
        />
        <span className="truncate font-medium">{courseLabel(course)}</span>
      </button>
    </div>
  )
}

/** The term's top level: one folder per course. */
function CourseFolders({
  courses,
  programId,
  termId,
  uploads,
  location,
}: {
  courses: Course[]
  programId: string
  termId: string
  uploads: Uploads
  location: FilesLocation
}) {
  const [search, setSearch] = useState('')
  const preview = usePreviewLocation(location)
  const [over, setOver] = useState<string | null>(null)
  const [view] = useUiPref<'list' | 'grid'>('files.view', 'list')
  const link = useExternalLink()
  // Files dropped beside the folders have no course to go to.
  const dragging = useFileDrop(NOOP)
  const query = useDebounced(search, 300)
  const contentSearch = useContentSearch(programId, query, { termId })
  const lists = useQueries({ queries: courses.map((course) => courseFilesOptions(course.id)) })

  const folders: Folder[] = courses.map((course, index) => ({ course, list: lists[index] }))
  const byCourse = new Map(courses.map((c) => [c.id, c]))
  const allItems = lists.flatMap((q) => q.data?.items ?? [])
  // A search hit anywhere in the term opens here; once every course is loaded, a file that is
  // gone closes.
  const fileGone =
    location.file !== null &&
    lists.every((q) => q.data) &&
    !allItems.some((i) => i.id === location.file)
  useEffect(() => {
    if (fileGone) location.go({ file: null }, { replace: true })
  }, [fileGone, location])
  const needle = search.trim()
  const searching = needle.length > 0
  const names = matchNames(
    needle,
    lists.flatMap((q) => (q.data ? [q.data] : [])),
  )
  const open = (item: ItemOut) => {
    if (item.kind === 'link' && item.url) link.open(item.url)
    else preview.show({ itemId: item.id })
  }
  const handlers: FolderHandlers = {
    open: (courseId) => location.go({ course: courseId, folder: null, file: null }),
    over,
    setOver,
    drop: (courseId, files) =>
      uploads.start(files, {
        courseId,
        folderId: null,
      }),
  }

  return (
    <div className="relative flex flex-col gap-3">
      <div className="flex min-h-9 flex-wrap items-center gap-2">
        <InputGroup className="w-64">
          <InputGroupInput
            type="search"
            aria-label={m.files_search_term()}
            placeholder={m.files_search_term()}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={clearOnEscape(search, () => setSearch(''))}
          />
          <InputGroupAddon>
            <Search aria-hidden />
          </InputGroupAddon>
          <InputGroupAddon align="inline-end">
            {search ? (
              <InputGroupButton
                size="icon-xs"
                aria-label={m.common_search_clear()}
                onClick={(event) => clearSearch(event, () => setSearch(''))}
              >
                <X aria-hidden />
              </InputGroupButton>
            ) : null}
          </InputGroupAddon>
        </InputGroup>
        <div className="ml-auto flex items-center gap-2">
          <ViewToggle />
          {/* Files go into a course: open one first, or drop them on its folder. */}
          <Tooltip>
            {/* Focusable while disabled, so the reason can be read from the keyboard too. */}
            <TooltipTrigger
              render={
                <Button disabled focusableWhenDisabled className="aria-disabled:opacity-50" />
              }
            >
              <Upload aria-hidden />
              {m.files_upload()}
            </TooltipTrigger>
            <TooltipContent>{m.files_upload_open_course()}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="flex h-8 items-center">
        <FilesNavBar up={null} onNavigate={() => setSearch('')} />
        {searching ? (
          <p className="truncate text-sm text-muted-foreground">
            {m.files_search_results_for({ query: search.trim() })}
          </p>
        ) : (
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbPage>{m.files_all_courses()}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        )}
      </div>

      <HandlersContext value={handlers}>
        {searching ? (
          <SearchResults
            needle={needle}
            folderMatches={names.folders}
            nameMatches={names.items}
            hits={contentSearch.data?.results ?? []}
            loading={query.trim().length >= 2 && (contentSearch.isFetching || search !== query)}
            pendingNames={(contentSearch.data?.pending_items ?? []).map((p) => p.display_name)}
            courseName={(id) => {
              const course = byCourse.get(id)
              return course ? courseLabel(course) : ''
            }}
            onOpenFolder={(f) => location.go({ course: f.course_id, folder: f.id, file: null })}
            onOpenItem={open}
            onOpenHit={(hit) =>
              preview.show({ itemId: hit.item_id, page: hit.page_from, terms: searchTerms(query) })
            }
            onClear={() => setSearch('')}
          />
        ) : view === 'grid' ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-3">
            {folders.map((folder) => (
              <FolderTile key={folder.course.id} folder={folder} />
            ))}
          </div>
        ) : (
          <FolderTable folders={folders} />
        )}
      </HandlersContext>

      <UsageBar />

      {dragging ? (
        <FileDropOverlay
          label={
            over
              ? m.files_drop_here({ folder: courseLabel(byCourse.get(over) as Course) })
              : m.files_drop_on_a_course()
          }
        />
      ) : null}

      {link.dialog}
      <PreviewDialog target={preview.target} {...preview.props} />
    </div>
  )
}
