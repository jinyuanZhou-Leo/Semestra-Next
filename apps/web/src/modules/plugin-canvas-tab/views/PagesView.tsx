import { lmsPageGetOptions, lmsPageListOptions } from '@semestra/api-client/react-query'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { FileText, Lock } from 'lucide-react'
import { SafeHtml } from '@/components/SafeHtml'
import { formatDateTime } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { Badge } from '@/ui/badge'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/ui/item'
import { CanvasBoundary } from '../CanvasBoundary'
import { useCanvasPage } from '../context'
import { DetailHeader, OpenInCanvas, useInternalLinks } from './common'

/** The course's pages; `selected` (a page ref) opens one in place (M16 §4). */
export function PagesView({ selected }: { selected?: string }) {
  if (selected) return <PageView pageRef={selected} withBack />
  return <PageList />
}

function PageList() {
  const { courseId, query, go } = useCanvasPage()
  const list = useQuery({
    ...lmsPageListOptions({ path: { course_id: courseId }, query }),
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
              <FileText aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{m.canvas_tab_pages_empty()}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      }
    >
      {(data) => (
        <ItemGroup className="gap-1">
          {data.items.map((p) => (
            <Item
              key={p.ref}
              size="sm"
              render={
                // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- the Item's children label it
                <button
                  type="button"
                  className="w-full text-left hover:bg-muted/50"
                  onClick={() => go({ tab: 'pages', ref: p.ref })}
                />
              }
            >
              <ItemContent>
                <ItemTitle className="line-clamp-1">{p.title}</ItemTitle>
                {p.updated_at ? (
                  <ItemDescription>
                    {m.canvas_tab_updated_at({ time: formatDateTime(p.updated_at) })}
                  </ItemDescription>
                ) : null}
              </ItemContent>
              {p.front_page ? (
                <ItemActions>
                  <Badge variant="secondary">{m.canvas_tab_front_page()}</Badge>
                </ItemActions>
              ) : null}
            </Item>
          ))}
        </ItemGroup>
      )}
    </CanvasBoundary>
  )
}

/** One page as cleaned HTML; also the home view of courses whose Canvas home is a page. */
export function PageView({ pageRef, withBack }: { pageRef: string; withBack?: boolean }) {
  const { courseId, query, go } = useCanvasPage()
  const onLink = useInternalLinks()
  const page = useQuery({
    ...lmsPageGetOptions({ path: { course_id: courseId, ref: pageRef }, query }),
    placeholderData: keepPreviousData,
  })
  return (
    <CanvasBoundary query={page}>
      {(p) => (
        <article className="space-y-4">
          {withBack ? (
            <DetailHeader
              title={p.title}
              meta={
                p.updated_at
                  ? m.canvas_tab_updated_at({ time: formatDateTime(p.updated_at) })
                  : null
              }
              webUrl={p.web_url}
              onBack={() => go({ tab: 'pages' })}
            />
          ) : (
            <div className="flex items-start justify-between gap-3">
              <h2 className="font-heading text-lg font-semibold">{p.title}</h2>
              {p.web_url ? <OpenInCanvas href={p.web_url} /> : null}
            </div>
          )}
          {p.locked ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Lock aria-hidden />
                </EmptyMedia>
                <EmptyTitle>{m.canvas_tab_page_locked()}</EmptyTitle>
                {p.lock_explanation ? (
                  <EmptyDescription>{p.lock_explanation}</EmptyDescription>
                ) : null}
              </EmptyHeader>
            </Empty>
          ) : p.html ? (
            <SafeHtml html={p.html} onInternalLink={onLink} />
          ) : (
            <p className="text-sm text-muted-foreground">{m.canvas_tab_page_blank()}</p>
          )}
        </article>
      )}
    </CanvasBoundary>
  )
}
