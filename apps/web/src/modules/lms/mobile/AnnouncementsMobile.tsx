import { lmsCourseLinkGetOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { CircleAlert, ExternalLink, Megaphone } from 'lucide-react'
import { useState } from 'react'
import type { PageProps } from '@/app/extensions'
import { MobileList, MobileSection } from '@/app/mobile/MobilePage'
import { useNow } from '@/hooks/use-now'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Alert, AlertTitle } from '@/ui/alert'
import { Button } from '@/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/ui/drawer'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { Skeleton } from '@/ui/skeleton'
import { postedLabel, postKey } from '../announcements'
import { Attachments } from '../content/Attachments'
import { type LmsContent, LmsContentContext } from '../content/context'
import { useLmsDisplay } from '../content/display'
import { useLmsLinkOpener } from '../content/link-opener'
import { LmsHtml } from '../content/LmsContent'
import { type Post, useAnnouncements } from '../posts'
import { useProviderName } from '../providers'
import { useMarkRead } from '../read-state'

const keyOf = (p: Post) => postKey(p.course.id, p.item.external_id)

/**
 * A course's announcements on a phone (M17 §4.1): newest first, the unread ones marked; one opens
 * in a page that slides up, at the same address as on the desktop (`?post=`), so a notification
 * opens it directly.
 */
export default function AnnouncementsMobile({ scope }: PageProps) {
  const search = useSearch({ strict: false }) as { post?: string }
  const navigate = useNavigate()
  const posts = useAnnouncements(scope)
  const now = useNow()
  const open = posts.rows.find((p) => keyOf(p) === search.post) ?? null
  // Kept while the drawer closes, so its text doesn't vanish under the animation.
  const [shown, setShown] = useState(open)
  if (open && (!shown || keyOf(open) !== keyOf(shown))) setShown(open)
  const go = (post: string | undefined) =>
    void navigate({
      to: '.',
      search: (prev: Record<string, unknown>) => ({ ...prev, post }),
      replace: post === undefined,
    })
  useMarkRead(open?.course.id, open?.item.external_id, open?.item.unread ?? false)

  if (posts.failed && posts.rows.length === 0) {
    return (
      <div className="px-4 pt-5">
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertTitle>{m.common_load_failed()}</AlertTitle>
        </Alert>
      </div>
    )
  }
  if (posts.loading) {
    return (
      <MobileSection title={m.lms_announcements_page_title()}>
        <Skeleton className="h-48 rounded-2xl" />
      </MobileSection>
    )
  }
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
            <EmptyDescription>{m.lms_announcements_not_read_ended()}</EmptyDescription>
          ) : posts.notRead === 'paused' ? (
            <EmptyDescription>{m.lms_announcements_not_read_paused()}</EmptyDescription>
          ) : null}
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <>
      <MobileSection title={m.lms_announcements_page_title()}>
        <MobileList label={m.lms_announcements_page_title()}>
          {posts.rows.map((p) => (
            <li key={keyOf(p)}>
              <button
                type="button"
                className="flex w-full gap-2.5 px-4 py-3 text-left"
                onClick={() => go(keyOf(p))}
              >
                <span className="flex h-5 w-2 shrink-0 items-center">
                  {p.item.unread ? (
                    <span className="size-2 rounded-full bg-primary">
                      <span className="sr-only">{m.lms_announcements_unread()}</span>
                    </span>
                  ) : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span
                      className={cn(
                        'line-clamp-1 flex-1',
                        p.item.unread ? 'font-semibold' : 'font-medium',
                      )}
                    >
                      {p.item.title}
                    </span>
                    {p.item.posted_at ? (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {postedLabel(p.item.posted_at, now)}
                      </span>
                    ) : null}
                  </span>
                  {p.item.text ? (
                    <span className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
                      {p.item.text}
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </MobileList>
      </MobileSection>
      <Drawer open={open !== null} onOpenChange={(o) => !o && go(undefined)} showSwipeHandle>
        <DrawerContent className="h-[92dvh]">
          {shown ? <Reading key={keyOf(shown)} post={shown} onOpenPost={go} /> : null}
        </DrawerContent>
      </Drawer>
    </>
  )
}

// The drawer centres its header; the text under it is left-aligned, so the header is too.
const HEADER = 'pb-3 group-data-[swipe-axis=y]/drawer-popup:text-left'

function Reading({
  post: { item: a, course },
  onOpenPost,
}: {
  post: Post
  onOpenPost: (key: string) => void
}) {
  const link = useQuery(lmsCourseLinkGetOptions({ path: { course_id: course.id } })).data?.link
  const provider = useProviderName(link?.provider) ?? link?.provider ?? ''
  const { display, setDisplay } = useLmsDisplay()
  const openLink = useLmsLinkOpener({
    programId: course.program_id,
    courseId: course.id,
    targets: a.targets,
    pages: false,
    onAnnouncement: (ref) => onOpenPost(postKey(course.id, ref)),
  })
  const content: LmsContent = { courseId: course.id, provider, display, setDisplay, openLink }
  const meta = [a.author, a.posted_at ? formatDateTime(a.posted_at) : null]
    .filter(Boolean)
    .join(' · ')
  return (
    <LmsContentContext value={content}>
      <DrawerHeader className={HEADER}>
        <DrawerTitle className="font-heading text-lg leading-snug">{a.title}</DrawerTitle>
        <DrawerDescription>{meta}</DrawerDescription>
      </DrawerHeader>
      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
        {a.html ? (
          <LmsHtml html={a.html} />
        ) : (
          <p className="text-sm whitespace-pre-wrap">{a.text}</p>
        )}
        <Attachments
          files={a.attachments ?? []}
          programId={course.program_id}
          courseId={course.id}
        />
        {a.web_url && provider ? (
          <Button
            variant="outline"
            className="self-start"
            nativeButton={false}
            // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- the children label it
            render={<a href={a.web_url} target="_blank" rel="noreferrer" />}
          >
            <ExternalLink aria-hidden />
            {m.lms_open_in({ provider })}
          </Button>
        ) : null}
      </div>
    </LmsContentContext>
  )
}
