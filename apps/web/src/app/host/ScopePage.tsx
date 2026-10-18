import { FileQuestion } from 'lucide-react'
import { Suspense } from 'react'
import { m } from '@/paraglide/messages'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import type { Scope } from '../extensions'
import { usePages } from '../registry'

/** Renders the page `pageId` of a scope, or an "unavailable" state for unknown ids (M00 §4.3). */
export function ScopePage({ scope, pageId }: { scope: Scope; pageId: string }) {
  const page = usePages(scope).find((p) => p.id === pageId)
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
    <Suspense fallback={null}>
      <Page scope={scope} />
    </Suspense>
  )
}
