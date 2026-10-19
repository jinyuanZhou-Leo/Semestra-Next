import { ArrowLeft, ExternalLink } from 'lucide-react'
import type { ReactNode } from 'react'
import type { InternalLink } from '@/components/SafeHtml'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { useCanvasPage } from '../context'
import { refLocation } from '../navigation'

/** The title row of an item opened inside a view: back to the list, the item, Canvas. */
export function DetailHeader({
  title,
  meta,
  webUrl,
  onBack,
}: {
  title: string
  meta?: ReactNode
  webUrl?: string | null
  onBack: () => void
}) {
  return (
    <div className="space-y-2">
      <Button variant="ghost" size="sm" className="-ml-2" onClick={onBack}>
        <ArrowLeft aria-hidden />
        {m.canvas_tab_back()}
      </Button>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-heading text-lg font-semibold">{title}</h2>
          {meta ? <p className="text-sm text-muted-foreground">{meta}</p> : null}
        </div>
        {webUrl ? <OpenInCanvas href={webUrl} /> : null}
      </div>
    </div>
  )
}

export function OpenInCanvas({ href, label }: { href: string; label?: string }) {
  return (
    <Button
      variant="outline"
      size="sm"
      className="shrink-0"
      // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- the children label it
      render={<a href={href} target="_blank" rel="noopener noreferrer" />}
      nativeButton={false}
    >
      <ExternalLink aria-hidden />
      {label ?? m.canvas_tab_open_in_canvas()}
    </Button>
  )
}

/**
 * Opens a Canvas link from inside HTML in the plugin: pages, assignments, quizzes, modules and
 * announcements switch the view, files open the preview; anything else stays a normal link.
 */
export function useInternalLinks() {
  const { go, openFile } = useCanvasPage()
  return (link: InternalLink) => {
    if (link.kind === 'file') {
      openFile(link.ref)
      return true
    }
    const target = refLocation(link)
    if (!target) return false
    go(target)
    return true
  }
}
