import { type AnnouncementList, lmsAnnouncementMarkRead } from '@semestra/api-client'
import {
  lmsAnnouncementListOptions,
  lmsAnnouncementListQueryKey,
  settingsValueGetOptions,
} from '@semestra/api-client/react-query'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Megaphone } from 'lucide-react'
import { useEffect } from 'react'
import { SafeHtml } from '@/components/SafeHtml'
import { formatDateTime } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/ui/item'
import { CanvasBoundary } from '../CanvasBoundary'
import { useCanvasPage } from '../context'
import { DetailHeader, useInternalLinks } from './common'

/** The account setting `lms.allow_writes`: may Semestra change things on the platform (M09). */
function useWritesAllowed(): boolean {
  const values = useQuery({
    ...settingsValueGetOptions({ path: { namespace: 'lms' } }),
    staleTime: 60_000,
  }).data?.values as { allow_writes?: boolean } | undefined
  return values?.allow_writes ?? false
}

/**
 * Opening an unread announcement marks it read on Canvas too, when the user allowed writes; the
 * lists here and on the course board drop the dot without refetching.
 */
function useMarkRead(courseId: string, id: string | undefined, unread: boolean) {
  const queryClient = useQueryClient()
  const allowed = useWritesAllowed()
  useEffect(() => {
    if (!id || !unread || !allowed) return
    lmsAnnouncementMarkRead({
      path: { course_id: courseId, announcement_id: id },
      throwOnError: true,
    }).then(
      () =>
        queryClient.setQueriesData<AnnouncementList>(
          { queryKey: lmsAnnouncementListQueryKey({ path: { course_id: courseId } }) },
          (list) =>
            list && {
              ...list,
              items: list.items.map((a) => (a.external_id === id ? { ...a, unread: false } : a)),
            },
        ),
      // Best effort: the announcement is open either way, and stays unread on Canvas.
      () => {},
    )
  }, [courseId, id, unread, allowed, queryClient])
}

/** Announcements, newest first; one opens in place with its cleaned HTML (M16 §4). */
export function AnnouncementsView({ selected }: { selected?: string }) {
  const { courseId, go } = useCanvasPage()
  const onLink = useInternalLinks()
  const list = useQuery({
    ...lmsAnnouncementListOptions({ path: { course_id: courseId } }),
    placeholderData: keepPreviousData,
  })
  const opened = selected ? list.data?.items.find((a) => a.external_id === selected) : undefined
  useMarkRead(courseId, opened?.external_id, opened?.unread ?? false)
  return (
    <CanvasBoundary
      query={list}
      isEmpty={(data) => data.items.length === 0}
      empty={
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Megaphone aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{m.lms_announcements_empty()}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      }
    >
      {(data) => {
        const open = selected ? data.items.find((a) => a.external_id === selected) : undefined
        if (open) {
          const meta = [open.author, open.posted_at ? formatDateTime(open.posted_at) : null]
            .filter(Boolean)
            .join(' · ')
          return (
            <article className="space-y-4">
              <DetailHeader
                title={open.title}
                meta={meta}
                webUrl={open.web_url}
                onBack={() => go({ tab: 'announcements' })}
              />
              {open.html ? <SafeHtml html={open.html} onInternalLink={onLink} /> : null}
            </article>
          )
        }
        return (
          <ItemGroup className="gap-1">
            {data.items.map((a) => (
              <Item
                key={a.external_id}
                size="sm"
                render={
                  // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- the children label it
                  <button
                    type="button"
                    className="w-full text-left hover:bg-muted/50"
                    onClick={() => go({ tab: 'announcements', ref: a.external_id })}
                  />
                }
              >
                <ItemContent>
                  <ItemTitle className="line-clamp-1">
                    {a.unread ? (
                      <span className="size-2 shrink-0 rounded-full bg-primary">
                        <span className="sr-only">{m.canvas_tab_unread()}</span>
                      </span>
                    ) : null}{' '}
                    {a.title}
                  </ItemTitle>
                  <ItemDescription>
                    {[a.author, a.posted_at ? formatDateTime(a.posted_at) : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </ItemDescription>
                </ItemContent>
              </Item>
            ))}
          </ItemGroup>
        )
      }}
    </CanvasBoundary>
  )
}
