import { type AnnouncementAttachment, type Course, lmsSyncRequest } from '@semestra/api-client'
import { lmsCourseLinkGetOptions } from '@semestra/api-client/react-query'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useCanGoBack, useNavigate, useRouter, useSearch } from '@tanstack/react-router'
import { ArrowLeft, CircleAlert, Megaphone, SearchX } from 'lucide-react'
import type { PageProps } from '@/app/extensions'
import { useNow } from '@/hooks/use-now'
import { formatBytes, formatDateTime } from '@/lib/format'
import { toastError } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { courseColor, courseLabel } from '@/modules/academics/color'
import { FileIcon } from '@/modules/files/components/FileIcon'
import { filePath } from '@/modules/files/location'
import { m } from '@/paraglide/messages'
import { Alert, AlertTitle } from '@/ui/alert'
import { Button } from '@/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/ui/empty'
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/ui/item'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/ui/select'
import { ScrollArea } from '@/ui/scroll-area'
import { Skeleton } from '@/ui/skeleton'
import { Spinner } from '@/ui/spinner'
import { postedLabel, postKey } from '../announcements'
import { type LmsContent, LmsContentContext, type LmsDisplay } from '../content/context'
import { useLmsDisplay } from '../content/display'
import { useLmsLinkOpener } from '../content/link-opener'
import { fileContentUrl } from '../content/file-url'
import { LmsHtml, ViewHeader } from '../content/LmsContent'
import { type Post, useAnnouncements } from '../posts'
import { useProviderName } from '../providers'
import { useMarkRead } from '../read-state'

const ALL = '__all__'

/**
 * The list and the open announcement side by side once the content area has room for both (the
 * list narrower while it is tight); below that one at a time. The page itself doesn't scroll: it
 * fills the content area (size containment keeps it from growing it), and the list and the announcement each
 * scroll on their own, like a mail app.
 */
const SPLIT =
  'grid min-h-0 flex-1 contain-size grid-rows-[minmax(0,1fr)] gap-6 @page-lg/main:grid-cols-[17rem_minmax(0,1fr)] @page-xl/main:grid-cols-[22rem_minmax(0,1fr)]'

const keyOf = (p: Post) => postKey(p.course.id, p.item.external_id)

/**
 * The 公告 page (M09 §6): a course's LMS announcements, or on a term every linked course's
 * together, newest first. A list on the left and the open announcement on the right; on a narrow
 * page the announcement takes the list's place.
 */
export default function AnnouncementsPage({ scope }: PageProps) {
  const search = useSearch({ strict: false }) as { post?: string; course?: string }
  const navigate = useNavigate()
  const router = useRouter()
  const term = scope.kind === 'term'
  const posts = useAnnouncements(scope)
  const filter = term ? (search.course ?? ALL) : ALL
  const shown = posts.rows.filter((p) => filter === ALL || p.course.id === filter)
  const open = posts.rows.find((p) => keyOf(p) === search.post)
  // Opening an announcement is a step Back returns from; the course filter is not.
  const go = (next: { post?: string; course?: string }, replace = false) =>
    void navigate({
      to: '.',
      search: (prev: Record<string, unknown>) => ({ ...prev, ...next }),
      replace,
    })
  const canGoBack = useCanGoBack()
  const back = () => (canGoBack ? router.history.back() : go({ post: undefined }, true))
  useMarkRead(open?.course.id, open?.item.external_id, open?.item.unread ?? false)
  // Kept here, not in the reading view: a display picked stays for the next announcement.
  const { display, setDisplay } = useLmsDisplay()
  const now = useNow()

  if (posts.failed && posts.rows.length === 0) {
    return (
      <Alert variant="destructive">
        <CircleAlert aria-hidden />
        <AlertTitle>{m.common_load_failed()}</AlertTitle>
      </Alert>
    )
  }
  if (posts.loading) return <ListSkeleton />
  if (posts.rows.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Megaphone aria-hidden />
          </EmptyMedia>
          <EmptyTitle>
            {posts.notRead ? m.lms_announcements_not_read() : m.lms_announcements_empty()}
          </EmptyTitle>
          {posts.notRead === 'ended' ? (
            <EmptyDescription>
              {term
                ? m.lms_announcements_not_read_ended_term()
                : m.lms_announcements_not_read_ended()}
            </EmptyDescription>
          ) : posts.notRead === 'paused' ? (
            <EmptyDescription>
              {term
                ? m.lms_announcements_not_read_paused_term()
                : m.lms_announcements_not_read_paused()}
            </EmptyDescription>
          ) : null}
        </EmptyHeader>
        {posts.notRead === 'ended' && scope.kind === 'course' ? (
          <EmptyContent>
            <SyncCourseButton programId={scope.programId} courseId={scope.courseId} />
          </EmptyContent>
        ) : null}
      </Empty>
    )
  }
  return (
    <div className={SPLIT}>
      <div
        className={cn('flex min-h-0 min-w-0 flex-col gap-3', open && 'hidden @page-lg/main:flex')}
      >
        {term ? (
          <CourseFilter
            courses={posts.courses}
            value={filter}
            onChange={(course) => go({ course: course === ALL ? undefined : course }, true)}
          />
        ) : null}
        {shown.length === 0 ? (
          <Empty className="rounded-2xl border border-solid border-border p-6">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchX aria-hidden />
              </EmptyMedia>
              <EmptyTitle>{m.lms_announcements_no_match()}</EmptyTitle>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="outline" size="sm" onClick={() => go({ course: undefined }, true)}>
                {m.common_clear_filters()}
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          // The rounded frame clips the rows; the scrollbar floats inside it, off the corners.
          <ScrollArea className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-border **:data-[slot=scroll-area-scrollbar]:my-2 **:data-[slot=scroll-area-thumb]:bg-muted-foreground/40">
            <ItemGroup className="gap-0 has-data-[size=sm]:gap-0">
              {shown.map((p) => (
                <PostRow
                  key={keyOf(p)}
                  post={p}
                  withCourse={term}
                  unread={p.item.unread}
                  selected={p === open}
                  now={now}
                  onOpen={() => go({ post: keyOf(p) })}
                />
              ))}
            </ItemGroup>
          </ScrollArea>
        )}
      </div>
      {open ? (
        <Reading
          key={keyOf(open)}
          post={open}
          withCourse={term}
          onBack={back}
          onOpenPost={(key) => go({ post: key })}
          display={display}
          setDisplay={setDisplay}
        />
      ) : (
        <Empty className="hidden rounded-2xl border border-solid border-border @page-lg/main:flex">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Megaphone aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{m.lms_announcements_pick()}</EmptyTitle>
            <EmptyDescription>{m.lms_announcements_pick_description()}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  )
}

function CourseFilter({
  courses,
  value,
  onChange,
}: {
  courses: readonly Course[]
  value: string
  onChange: (course: string) => void
}) {
  const items = [
    { value: ALL, label: m.lms_announcements_all_courses() },
    ...courses.map((c) => ({ value: c.id, label: courseLabel(c) })),
  ]
  const picked = courses.find((c) => c.id === value)
  return (
    <Select items={items} value={value} onValueChange={(v) => onChange(v ?? ALL)}>
      <SelectTrigger className="w-full" aria-label={m.lms_announcements_course_filter()}>
        <SelectValue>
          {picked ? <CourseName course={picked} /> : m.lms_announcements_all_courses()}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value={ALL}>{m.lms_announcements_all_courses()}</SelectItem>
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          {courses.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              <CourseName course={c} />
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

function CourseName({ course, className }: { course: Course; className?: string }) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: courseColor(course) }}
      />
      <span className="truncate">{courseLabel(course)}</span>
    </span>
  )
}

function PostRow({
  post: { item: a, course },
  withCourse,
  unread,
  selected,
  now,
  onOpen,
}: {
  post: Post
  withCourse: boolean
  unread: boolean
  selected: boolean
  now: number
  onOpen: () => void
}) {
  return (
    <Item
      size="sm"
      className="rounded-none border-0 border-b border-border last:border-b-0"
      render={
        // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- the children label it
        <button
          type="button"
          aria-current={selected || undefined}
          className={cn(
            'w-full text-left hover:bg-muted/50',
            selected && 'bg-muted hover:bg-muted',
          )}
          onClick={onOpen}
        />
      }
    >
      <span className="flex h-5 w-2 shrink-0 items-center self-start">
        {unread ? (
          <span className="size-2 rounded-full bg-primary">
            <span className="sr-only">{m.lms_announcements_unread()}</span>
          </span>
        ) : null}
      </span>
      <ItemContent className="min-w-0 gap-0.5">
        <div className="flex items-baseline gap-2">
          <ItemTitle className={cn('line-clamp-1 flex-1', unread && 'font-semibold')}>
            {a.title}
          </ItemTitle>
          {a.posted_at ? (
            <span className="shrink-0 text-xs text-muted-foreground">
              {postedLabel(a.posted_at, now)}
            </span>
          ) : null}
        </div>
        {a.text ? <p className="line-clamp-2 text-sm text-muted-foreground">{a.text}</p> : null}
        {withCourse ? (
          <ItemDescription className="text-xs">
            <CourseName course={course} />
          </ItemDescription>
        ) : null}
      </ItemContent>
    </Item>
  )
}

function Reading({
  post: { item: a, course },
  withCourse,
  onBack,
  onOpenPost,
  display,
  setDisplay,
}: {
  post: Post
  withCourse: boolean
  onBack: () => void
  onOpenPost: (key: string) => void
  display: LmsDisplay
  setDisplay: (display: LmsDisplay) => void
}) {
  const link = useQuery(lmsCourseLinkGetOptions({ path: { course_id: course.id } })).data?.link
  const provider = useProviderName(link?.provider) ?? link?.provider ?? ''
  const meta = [a.author, a.posted_at ? formatDateTime(a.posted_at) : null]
    .filter(Boolean)
    .join(' · ')
  const openLink = useLmsLinkOpener({
    programId: course.program_id,
    courseId: course.id,
    targets: a.targets,
    onAnnouncement: (ref) => onOpenPost(postKey(course.id, ref)),
  })
  const content: LmsContent = { courseId: course.id, provider, display, setDisplay, openLink }
  return (
    <LmsContentContext value={content}>
      {/* The back button and the header stay put; only the text and the attachments scroll. */}
      <article className="flex min-h-0 min-w-0 flex-col overflow-hidden @page-lg/main:rounded-2xl @page-lg/main:border @page-lg/main:border-border">
        <div className="flex flex-col gap-4 pb-4 @page-lg/main:px-6 @page-lg/main:pt-6">
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 self-start @page-lg/main:hidden"
            onClick={onBack}
          >
            <ArrowLeft aria-hidden />
            {m.lms_announcements_back()}
          </Button>
          <ViewHeader
            title={a.title}
            meta={
              <span className="flex flex-wrap items-center gap-x-2">
                {withCourse ? <CourseName course={course} className="text-foreground" /> : null}
                {withCourse && meta ? <span aria-hidden>·</span> : null}
                <span>{meta}</span>
              </span>
            }
            withDisplay={Boolean(a.html)}
            webUrl={a.web_url}
          />
        </div>
        <ScrollArea className="min-h-0 flex-1 **:data-[slot=scroll-area-scrollbar]:my-2 **:data-[slot=scroll-area-thumb]:bg-muted-foreground/40">
          <div className="flex flex-col gap-4 @page-lg/main:px-6 @page-lg/main:pb-6">
            {a.html ? <LmsHtml html={a.html} /> : null}
            <Attachments files={a.attachments ?? []} course={course} />
          </div>
        </ScrollArea>
      </article>
    </LmsContentContext>
  )
}

/**
 * The files attached to an announcement: the course's own copy opens in the file preview; one
 * the course's files do not have opens from the platform through Semestra, in a new tab.
 */
function Attachments({ files, course }: { files: AnnouncementAttachment[]; course: Course }) {
  if (files.length === 0) return null
  return (
    <section className="flex flex-col gap-2 border-t border-border pt-4">
      <h3 className="text-xs text-muted-foreground">
        {m.lms_announcements_attachments({ count: files.length })}
      </h3>
      <ItemGroup className="grid gap-2 @page-lg/main:grid-cols-2">
        {files.map((file) => (
          <Item
            key={file.external_id}
            variant="outline"
            size="sm"
            render={
              file.file ? (
                <Link
                  to={filePath(course.program_id, {
                    ...file.file,
                    folder_id: file.file.folder_id ?? null,
                  })}
                  className="hover:bg-muted/50"
                />
              ) : (
                // oxlint-disable-next-line jsx-a11y/anchor-has-content, jsx-a11y/control-has-associated-label -- the children label it
                <a
                  href={fileContentUrl(course.id, file.external_id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:bg-muted/50"
                />
              )
            }
          >
            <ItemMedia>
              <FileIcon
                item={{ kind: 'file', mime_type: file.mime_type ?? null }}
                aria-hidden
                className="size-4 text-muted-foreground"
              />
            </ItemMedia>
            <ItemContent className="min-w-0 gap-0">
              <ItemTitle className="w-full">
                <span className="truncate">{file.name}</span>
              </ItemTitle>
              {file.size_bytes != null ? (
                <ItemDescription className="text-xs">
                  {formatBytes(file.size_bytes)}
                </ItemDescription>
              ) : null}
            </ItemContent>
          </Item>
        ))}
      </ItemGroup>
    </section>
  )
}

function ListSkeleton() {
  return (
    <div className={SPLIT}>
      <div className="space-y-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    </div>
  )
}

/** Reads an ended term's course now: the sync no longer does on its own (M09 §4.3). */
function SyncCourseButton({ programId, courseId }: { programId: string; courseId: string }) {
  const sync = useMutation({
    mutationFn: () =>
      lmsSyncRequest({
        path: { program_id: programId },
        body: { course_id: courseId, force: true },
        throwOnError: true,
      }),
    onError: toastError,
  })
  return (
    // Queued is all it waits for: the sync's status line shows the rest, and the list replaces
    // this once the course is read.
    <Button size="sm" disabled={sync.isPending} onClick={() => sync.mutate()}>
      {sync.isPending ? <Spinner aria-hidden /> : null}
      {m.lms_announcements_sync_now()}
    </Button>
  )
}
