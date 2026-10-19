import { lmsAnnouncementsListOptions } from '@semestra/api-client/react-query'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Megaphone } from 'lucide-react'
import { SafeHtml } from '@/components/SafeHtml'
import { formatDateTime } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/ui/item'
import { CanvasBoundary } from '../CanvasBoundary'
import { useCanvasPage } from '../context'
import { DetailHeader, useInternalLinks } from './common'

/** Announcements, newest first; one opens in place with its cleaned HTML (M16 §4). */
export function AnnouncementsView({ selected }: { selected?: string }) {
  const { courseId, query, go } = useCanvasPage()
  const onLink = useInternalLinks()
  const list = useQuery({
    ...lmsAnnouncementsListOptions({ path: { course_id: courseId }, query }),
    placeholderData: keepPreviousData,
  })
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
                  <ItemTitle className="line-clamp-1">{a.title}</ItemTitle>
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
