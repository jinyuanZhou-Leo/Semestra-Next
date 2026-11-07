import { lmsPageGetOptions, lmsPageListOptions } from '@semestra/api-client/react-query'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { FileText, Lock } from 'lucide-react'
import { formatDateTime } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { Badge } from '@/ui/badge'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/ui/item'
import { CanvasBoundary } from '../CanvasBoundary'
import { useCanvasPage } from '../context'
import { CanvasHtml, DetailHeader, ViewHeader } from './common'

/** The course's pages; `selected` (a page ref) opens one in place (M16 §4). */
export function PagesView({ selected }: { selected?: string }) {
  if (selected) return <PageView pageRef={selected} withBack />
  return <PageList />
}

function PageList() {
  const { title, courseId, go } = useCanvasPage()
  const list = useQuery({
    ...lmsPageListOptions({ path: { course_id: courseId } }),
    placeholderData: keepPreviousData,
  })
  return (
    <div className="flex flex-1 flex-col gap-4">
      <ViewHeader title={title} />
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
    </div>
  )
}

/** One page as cleaned HTML; also the home view of courses whose Canvas home is a page. */
export function PageView({ pageRef, withBack }: { pageRef: string; withBack?: boolean }) {
  const { courseId, go } = useCanvasPage()
  const page = useQuery({
    ...lmsPageGetOptions({ path: { course_id: courseId, ref: pageRef } }),
    placeholderData: keepPreviousData,
  })
  return (
    <CanvasBoundary query={page}>
      {(p) => (
        <article className="flex flex-1 flex-col gap-4">
          {withBack ? (
            <DetailHeader
              title={p.title}
              meta={
                p.updated_at
                  ? m.canvas_tab_updated_at({ time: formatDateTime(p.updated_at) })
                  : null
              }
              webUrl={p.web_url}
              withDisplay={!p.locked && Boolean(p.html)}
              onBack={() => go({ tab: 'pages' })}
            />
          ) : (
            <ViewHeader
              title={p.title}
              webUrl={p.web_url}
              withDisplay={!p.locked && Boolean(p.html)}
            />
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
            <CanvasHtml html={p.html} />
          ) : (
            <p className="text-sm text-muted-foreground">{m.canvas_tab_page_blank()}</p>
          )}
        </article>
      )}
    </CanvasBoundary>
  )
}
