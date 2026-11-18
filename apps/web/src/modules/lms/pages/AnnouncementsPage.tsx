import type { Announcement, Course } from '@semestra/api-client'
import {
  lmsAnnouncementListOptions,
  lmsCourseLinkGetOptions,
  lmsTermAnnouncementListOptions,
} from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { Link, useCanGoBack, useNavigate, useRouter, useSearch } from '@tanstack/react-router'
import {
  ArrowLeft,
  CircleAlert,
  ExternalLink,
  Megaphone,
  Palette,
  SearchX,
  Type,
} from 'lucide-react'
import { useState } from 'react'
import type { PageProps } from '@/app/extensions'
import { SafeHtml } from '@/components/SafeHtml'
import { formatBytes, formatDate, formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { courseColor, courseLabel } from '@/modules/academics/color'
import { useCourse, useCourses } from '@/modules/academics/queries'
import { FileIcon } from '@/modules/files/components/FileIcon'
import { courseFilesPath, filePath } from '@/modules/files/location'
import { m } from '@/paraglide/messages'
import { Alert, AlertTitle } from '@/ui/alert'
import { Button } from '@/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
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
import { Skeleton } from '@/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { plainText, postKey } from '../announcements'
import { useProviderName } from '../providers'
import { useMarkRead } from '../read-state'

/** An announcement with the course it was posted in. */
type Post = { item: Announcement; course: Course }

const ALL = '__all__'

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
  const posts = usePosts(scope)
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
          <EmptyTitle>{m.lms_announcements_empty()}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <div className="grid min-h-0 flex-1 items-start gap-6 @page-lg/main:grid-cols-[24rem_minmax(0,1fr)]">
      <div className={cn('flex min-w-0 flex-col gap-3', open && 'hidden @page-lg/main:flex')}>
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
          <ItemGroup className="gap-0 overflow-hidden rounded-2xl border border-border">
            {shown.map((p) => (
              <PostRow
                key={keyOf(p)}
                post={p}
                withCourse={term}
                unread={Boolean(p.item.unread)}
                selected={p === open}
                onOpen={() => go({ post: keyOf(p) })}
              />
            ))}
          </ItemGroup>
        )}
      </div>
      {open ? (
        <Reading post={open} withCourse={term} onBack={back} />
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
  onOpen,
}: {
  post: Post
  withCourse: boolean
  unread: boolean
  selected: boolean
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
              {formatDate(a.posted_at)}
            </span>
          ) : null}
        </div>
        {a.html ? (
          <p className="line-clamp-2 text-sm text-muted-foreground">{plainText(a.html)}</p>
        ) : null}
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
}: {
  post: Post
  withCourse: boolean
  onBack: () => void
}) {
  const link = useQuery(lmsCourseLinkGetOptions({ path: { course_id: course.id } })).data?.link
  const provider = useProviderName(link?.provider) ?? link?.provider ?? ''
  const navigate = useNavigate()
  const [display, setDisplay] = useState<Display>('simplified')
  const meta = [a.author, a.posted_at ? formatDateTime(a.posted_at) : null]
    .filter(Boolean)
    .join(' · ')
  return (
    <article className="flex min-w-0 flex-col gap-4 @page-lg/main:sticky @page-lg/main:top-4 @page-lg/main:rounded-2xl @page-lg/main:border @page-lg/main:border-border @page-lg/main:p-6">
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 self-start @page-lg/main:hidden"
        onClick={onBack}
      >
        <ArrowLeft aria-hidden />
        {m.lms_announcements_back()}
      </Button>
      {/* SAMPLE (PR 4): the header and body the Canvas tab gives an announcement. */}
      <header className="flex min-h-9 flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <h2 className="font-heading text-lg font-semibold">{a.title}</h2>
          <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            {withCourse ? <CourseName course={course} className="text-foreground" /> : null}
            {withCourse && meta ? <span aria-hidden>·</span> : null}
            <span>{meta}</span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {a.html ? <DisplayMenu display={display} onChange={setDisplay} /> : null}
          {a.web_url ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={m.lms_open_in({ provider })}
                    nativeButton={false}
                    render={
                      // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- labelled by aria-label
                      <a href={a.web_url} target="_blank" rel="noreferrer" />
                    }
                  />
                }
              >
                <ExternalLink aria-hidden />
              </TooltipTrigger>
              <TooltipContent>{m.lms_open_in({ provider })}</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </header>
      {a.html ? (
        <SafeHtml
          html={a.html}
          original={display === 'original'}
          onInternalLink={(target) => {
            // Files open in the course's files; the rest of the kinds go to their own pages.
            if (target.kind !== 'file') return false
            void navigate({
              to: courseFilesPath(course.program_id, course.id, { itemId: target.ref }),
            })
            return true
          }}
        />
      ) : null}
      <Attachments files={(a as WithAttachments).attachments ?? []} programId={course.program_id} />
    </article>
  )
}

/**
 * SAMPLE (PR 4): the files a teacher attached, kept with the announcement. `item` is the course
 * file it is: it opens in the file preview, not on the platform.
 */
type Attachment = {
  name: string
  size_bytes: number
  mime_type: string | null
  item: { id: string; course_id: string; folder_id: string | null }
}
type WithAttachments = Announcement & { attachments?: Attachment[] }

function Attachments({ files, programId }: { files: Attachment[]; programId: string }) {
  if (files.length === 0) return null
  return (
    <section className="flex flex-col gap-2 border-t border-border pt-4">
      <h3 className="text-xs text-muted-foreground">
        {m.lms_announcements_attachments({ count: files.length })}
      </h3>
      <ItemGroup className="grid gap-2 @page-lg/main:grid-cols-2">
        {files.map((file) => (
          <Item
            key={file.item.id}
            variant="outline"
            size="sm"
            render={<Link to={filePath(programId, file.item)} className="hover:bg-muted/50" />}
          >
            <ItemMedia>
              <FileIcon
                item={{ kind: 'file', mime_type: file.mime_type }}
                aria-hidden
                className="size-4 text-muted-foreground"
              />
            </ItemMedia>
            <ItemContent className="min-w-0 gap-0">
              <ItemTitle className="w-full">
                <span className="truncate">{file.name}</span>
              </ItemTitle>
              <ItemDescription className="text-xs">{formatBytes(file.size_bytes)}</ItemDescription>
            </ItemContent>
          </Item>
        ))}
      </ItemGroup>
    </section>
  )
}

type Display = 'simplified' | 'original'
const DISPLAYS = [
  ['simplified', Type, m.settings_plugin_canvas_tab_display_option_simplified],
  ['original', Palette, m.settings_plugin_canvas_tab_display_option_original],
] as const

/** The Canvas tab's display switch: the app's reading typography, or the platform's own look. */
function DisplayMenu({ display, onChange }: { display: Display; onChange: (d: Display) => void }) {
  const [, Icon, name] = DISPLAYS.find(([d]) => d === display) ?? DISPLAYS[0]
  const label = `${m.canvas_tab_display()}: ${name()}`
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon-sm" aria-label={label} />}
            />
          }
        >
          <Icon aria-hidden />
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{m.canvas_tab_display()}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={display} onValueChange={(v) => onChange(v as Display)}>
            {DISPLAYS.map(([d, ItemIcon, text]) => (
              <DropdownMenuRadioItem key={d} value={d}>
                <ItemIcon aria-hidden />
                {text()}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ListSkeleton() {
  return (
    <div className="grid gap-6 @page-lg/main:grid-cols-[24rem_minmax(0,1fr)]">
      <div className="space-y-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    </div>
  )
}

/** The scope's announcements with their courses: the course's own, or the term's linked courses'. */
function usePosts(scope: PageProps['scope']) {
  const courseId = scope.kind === 'course' ? scope.courseId : ''
  const termId = scope.kind === 'term' ? scope.termId : ''
  const course = useCourse(courseId, { enabled: courseId !== '' }).data
  const own = useQuery({
    ...lmsAnnouncementListOptions({ path: { course_id: courseId } }),
    enabled: courseId !== '',
  })
  const courses = useCourses(scope.programId, termId || undefined, {
    enabled: termId !== '',
  }).data?.items
  const termList = useQuery({
    ...lmsTermAnnouncementListOptions({ path: { term_id: termId } }),
    enabled: termId !== '',
  })
  if (courseId) {
    const rows = course ? (own.data?.items ?? []).map((item) => ({ item, course })) : []
    return {
      rows,
      courses: course ? [course] : [],
      loading: own.isPending || !course,
      failed: own.isError,
    }
  }
  const byId = new Map((courses ?? []).map((c) => [c.id, c]))
  const rows = (termList.data?.items ?? []).flatMap((item): Post[] => {
    const c = byId.get(item.course_id)
    return c ? [{ item, course: c }] : []
  })
  const linked = (termList.data?.linked_course_ids ?? []).flatMap((id) => {
    const c = byId.get(id)
    return c ? [c] : []
  })
  return {
    rows,
    courses: linked,
    loading: termList.isPending || !courses,
    failed: termList.isError,
  }
}
