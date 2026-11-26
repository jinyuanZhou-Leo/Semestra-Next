import { FileText } from 'lucide-react'
import { useState } from 'react'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { usePreviewHere } from '../preview-here'
import { useFileItem } from '../queries'
import { PreviewDialog } from './PreviewDialog'

/** `"<item_id>:p3-4"` → the file and its page range; null for anything else. */
export function parseCitation(id: string): { itemId: string; from: number; to: number } | null {
  const match = /^(.+):p(\d+)-(\d+)$/.exec(id)
  if (!match?.[1]) return null
  return { itemId: match[1], from: Number(match[2]), to: Number(match[3]) }
}

export function pageRangeLabel(from: number, to: number) {
  return from === to ? m.files_page_single({ page: from }) : m.files_page_range({ from, to })
}

/**
 * A source chip, `<Citation id="item:p3-4" />` (M07 §6.4): the file name and pages; opens the
 * preview at that page. Used by the assistant (M12) and import reviews (M08). Inside the preview
 * of the same file (Sem beside it), it turns to that page there.
 */
export function Citation({ id, terms }: { id: string; terms?: readonly string[] }) {
  const parsed = parseCitation(id)
  const item = useFileItem(parsed?.itemId)
  const [open, setOpen] = useState(false)
  const here = usePreviewHere()
  if (!parsed) return null
  const inPlace = here?.itemId === parsed.itemId
  const name = item.data?.display_name ?? (item.isError ? m.files_citation_missing() : '…')
  return (
    <>
      <Button
        variant="secondary"
        size="xs"
        className="max-w-64 align-baseline"
        disabled={item.isError}
        onClick={() => (inPlace ? here.open(parsed.from, terms) : setOpen(true))}
      >
        <FileText aria-hidden />
        <span className="truncate">{name}</span>
        <span className="text-muted-foreground tabular-nums">
          {pageRangeLabel(parsed.from, parsed.to)}
        </span>
      </Button>
      {inPlace ? null : (
        <PreviewDialog
          target={{ itemId: parsed.itemId, page: parsed.from, terms }}
          open={open}
          onOpenChange={setOpen}
        />
      )}
    </>
  )
}
