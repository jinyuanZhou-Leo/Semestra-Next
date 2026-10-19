import { FileQuestion } from 'lucide-react'
import { m } from '@/paraglide/messages'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { Spinner } from '@/ui/spinner'
import type { Scope } from '../extensions'
import { usePageStatuses } from '../registry'
import { PluginBoundary } from './PluginBoundary'

/** Renders the page `pageId` of a scope, or an "unavailable" state for unknown ids (M00 §4.3). */
export function ScopePage({ scope, pageId }: { scope: Scope; pageId: string }) {
  const entry = usePageStatuses(scope).find((p) => p.page.id === pageId)
  if (entry?.status === 'pending') {
    return (
      <output className="flex items-center justify-center py-12">
        <Spinner aria-label={m.common_loading()} />
      </output>
    )
  }
  const page = entry?.status === 'available' ? entry.page : undefined
  if (!page) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileQuestion aria-hidden />
          </EmptyMedia>
          <EmptyTitle>{m.host_page_unavailable_title()}</EmptyTitle>
          <EmptyDescription>{m.host_page_unavailable_description()}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  const Page = page.component
  return (
    <PluginBoundary key={`${pageId}:${JSON.stringify(scope)}`}>
      <Page scope={scope} />
    </PluginBoundary>
  )
}
