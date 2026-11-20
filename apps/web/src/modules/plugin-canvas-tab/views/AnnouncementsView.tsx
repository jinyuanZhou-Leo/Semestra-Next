import { lmsAnnouncementListOptions } from '@semestra/api-client/react-query'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Megaphone } from 'lucide-react'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useMarkRead } from '@/modules/lms/read-state'
import { m } from '@/paraglide/messages'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/ui/item'
import { CanvasBoundary } from '../CanvasBoundary'
import { useCanvasPage } from '../context'
import { DetailHeader, LmsHtml, ViewHeader } from '@/modules/lms/content/LmsContent'

/** Announcements, newest first; one opens in place with its cleaned HTML (M16 §4). */
export function AnnouncementsView({ selected }: { selected?: string }) {
  const { title, courseId, go } = useCanvasPage()
  const list = useQuery({
    ...lmsAnnouncementListOptions({ path: { course_id: courseId } }),
    placeholderData: keepPreviousData,
  })
  const opened = selected ? list.data?.items.find((a) => a.external_id === selected) : undefined
  useMarkRead(courseId, opened?.external_id, opened?.unread ?? false)
  return (
    <div className="flex flex-1 flex-col gap-4">
      {selected ? null : <ViewHeader title={title} />}
      <CanvasBoundary
        query={list}
        isEmpty={(data) => data.items.length === 0}
        empty={
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Megaphone aria-hidden />
              </EmptyMedia>
              <EmptyTitle>
                {list.data?.not_read ? m.lms_announcements_not_read() : m.lms_announcements_empty()}
              </EmptyTitle>
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
              <article className="flex flex-1 flex-col gap-4">
                <DetailHeader
                  title={open.title}
                  meta={meta}
                  webUrl={open.web_url}
                  withDisplay={Boolean(open.html)}
                  onBack={() => go({ tab: 'announcements' })}
                />
                {open.html ? <LmsHtml html={open.html} /> : null}
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
                  <span className="flex h-5 w-2 shrink-0 items-center self-start">
                    {a.unread ? (
                      <span className="size-2 rounded-full bg-primary">
                        <span className="sr-only">{m.lms_announcements_unread()}</span>
                      </span>
                    ) : null}
                  </span>
                  <ItemContent className="min-w-0">
                    <ItemTitle className={cn('line-clamp-1', a.unread && 'font-semibold')}>
                      {a.title}
                    </ItemTitle>
                    {a.text ? (
                      <p className="line-clamp-1 text-sm text-muted-foreground">{a.text}</p>
                    ) : null}
                    <ItemDescription className="text-xs">
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
    </div>
  )
}
