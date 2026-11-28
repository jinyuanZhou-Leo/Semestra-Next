import { FileQuestion } from 'lucide-react'
import { toast } from 'sonner'
import { FileDropOverlay } from '@/components/FileDropOverlay'
import { accepts, useFileDrag } from '@/lib/file-drop'
import { m } from '@/paraglide/messages'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { Spinner } from '@/ui/spinner'
import type { Scope } from '../extensions'
import { useFileDrops, usePageStatuses } from '../registry'
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
    <>
      <PageFileDrop scope={scope} pageId={pageId} />
      <PluginBoundary key={`${pageId}:${JSON.stringify(scope)}`}>
        <Page scope={scope} />
      </PluginBoundary>
    </>
  )
}

/**
 * Files dragged onto a page that something takes (`fileDrops`, e.g. a syllabus onto the
 * gradebook): the drop overlay says what dropping them does. Files no contribution takes are
 * refused with the same toast as a drop zone's.
 */
function PageFileDrop({ scope, pageId }: { scope: Scope; pageId: string }) {
  const drops = useFileDrops(scope, pageId)
  const onDrop = (files: File[]) => {
    const drop = drops.find((d) => files.every((file) => accepts(d.accept, file)))
    if (drop) drop.onDrop(scope, files)
    else for (const file of files) toast.error(m.common_file_type_unsupported({ name: file.name }))
  }
  const types = useFileDrag(onDrop, drops.length > 0)
  const drop = types && drops.find((d) => types.every((type) => accepts(d.accept, { type })))
  return drop ? <FileDropOverlay label={drop.label()} className="inset-x-4 top-2 bottom-3" /> : null
}
