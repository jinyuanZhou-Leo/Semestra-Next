import type { Course, ItemOut } from '@semestra/api-client'
import { filesListOptions } from '@semestra/api-client/react-query'
import { useQueries } from '@tanstack/react-query'
import { ArrowRight, BookOpen, FolderOpen, Search } from 'lucide-react'
import { useState } from 'react'
import type { PageProps } from '@/app/extensions'
import { useUiPref } from '@/app/ui-pref'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { HistoryLink } from '@/components/HistoryLink'
import { courseColor, courseLabel } from '@/modules/academics/color'
import { coursePath } from '@/modules/academics/paths'
import { coursesOfTerm, useCourses } from '@/modules/academics/queries'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { Input } from '@/ui/input'
import { Skeleton } from '@/ui/skeleton'
import { useExternalLink } from '../components/ExternalLink'
import { FileBrowser } from '../components/FileBrowser'
import { PreviewDialog, type PreviewTarget } from '../components/PreviewDialog'
import { SearchResults, useContentSearch } from '../components/SearchResults'
import { searchTerms } from '../highlight'
import { useDebounced } from '../hooks'

const NOOP = () => {}

/** The `files` page of a term: every course's files, read-only, and search across them (M07 §6.2). */
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
  const [search, setSearch] = useState('')
  const [preview, setPreview] = useState<PreviewTarget | null>(null)
  const [view] = useUiPref<'list' | 'grid'>('files.view', 'list')
  const link = useExternalLink()
  const query = useDebounced(search, 300)
  const contentSearch = useContentSearch(programId, query, { termId })
  const lists = useQueries({
    queries: courses.map((course) => ({
      ...filesListOptions({
        path: { course_id: course.id },
        query: { recursive: true, limit: 500, sort: 'name' },
      }),
      staleTime: 30_000,
    })),
  })

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
  const allItems = lists.flatMap((q) => q.data?.items ?? [])
  const needle = search.trim().toLowerCase()
  const searching = needle.length > 0
  const loaded = lists.every((q) => q.data)

  return (
    <div className="space-y-3">
      <div className="flex min-h-9 items-center gap-2">
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            aria-label={m.files_search_term()}
            placeholder={m.files_search_term()}
            className="w-72 pl-9"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
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
      ) : loaded && allItems.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderOpen aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{m.files_term_empty_title()}</EmptyTitle>
            <EmptyDescription>{m.files_term_empty_description()}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="space-y-6">
          {courses.map((course, index) => {
            const items = lists[index]?.data?.items
            if (items?.length === 0) return null
            return (
              <section key={course.id} className="space-y-2">
                <div className="flex h-8 items-center gap-2">
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: courseColor(course) }}
                  />
                  <h2 className="min-w-0 truncate text-sm font-medium">{courseLabel(course)}</h2>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto text-muted-foreground"
                    render={<HistoryLink href={coursePath(programId, course.id, 'files')} />}
                  >
                    {m.files_open_course_files()}
                    <ArrowRight aria-hidden />
                  </Button>
                </div>
                {items ? (
                  <FileBrowser
                    folders={[]}
                    items={items}
                    view={view}
                    handlers={{ open, openFolder: NOOP, act: NOOP, readOnly: true }}
                  />
                ) : (
                  <Skeleton className="h-24 w-full rounded-2xl" />
                )}
              </section>
            )
          })}
        </div>
      )}

      {link.dialog}
      <PreviewDialog target={preview} onClose={() => setPreview(null)} />
    </div>
  )
}
