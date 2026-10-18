import { FileQuestion } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import { m } from '@/paraglide/messages'
import type { Scope } from '../extensions'
import { usePages } from '../registry'
import { PluginBoundary } from './PluginBoundary'

/** Renders the page `pageId` of a scope, or an "unavailable" state for unknown ids (M00 §4.3). */
export function ScopePage({ scope, pageId }: { scope: Scope; pageId: string }) {
  const page = usePages(scope).find((p) => p.id === pageId)
  if (!page) {
    return (
      <EmptyState
        icon={FileQuestion}
        title={m.host_page_unavailable_title()}
        description={m.host_page_unavailable_description()}
      />
    )
  }
  const Page = page.component
  return (
    <PluginBoundary key={`${pageId}:${JSON.stringify(scope)}`}>
      <Page scope={scope} />
    </PluginBoundary>
  )
}
