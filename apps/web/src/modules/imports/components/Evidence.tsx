import type { Evidence as EvidenceData, ImportItem } from '@semestra/api-client'
import { ExternalLink, Quote, ScanSearch } from 'lucide-react'
import type { ReactNode } from 'react'
import { apiUrl } from '@/lib/api-extras'
import { useDialogTarget } from '@/lib/dialog-target'
import { toastError } from '@/lib/errors'
import { PreviewDialog, type PreviewTarget } from '@/modules/files/components/PreviewDialog'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { unsureFields } from '../labels'
import { trackEdit, useItemUpdate } from '../queries'

/** Link to the uploaded file, at the page for PDFs (course files open in the M07 preview). */
export function sourceUrl(evidence: EvidenceData): string | null {
  if (!evidence.upload_id) return null
  const page = evidence.page ? `#page=${evidence.page}` : ''
  return `${apiUrl(`/imports/uploads/${evidence.upload_id}/content`)}${page}`
}

/** The quote's lines, highlighted in the preview (a PDF's text comes a line at a time). */
function quoteTerms(quote: string): string[] {
  return quote
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length >= 3)
}

/**
 * The quote a value was read from, with a way to the source: a course file opens in the M07
 * preview at that page with the quote highlighted; an upload opens as is.
 */
function SourceQuote({ evidence }: { evidence: EvidenceData }) {
  const preview = useDialogTarget<PreviewTarget>()
  const url = sourceUrl(evidence)
  const fileItemId = evidence.file_item_id
  return (
    <>
      <blockquote className="border-l-2 pl-3 whitespace-pre-wrap text-muted-foreground">
        {evidence.quote}
      </blockquote>
      <div className="flex">
        {fileItemId ? (
          <Button
            variant="link"
            className="h-auto p-0 text-xs"
            onClick={() =>
              preview.show({
                itemId: fileItemId,
                page: evidence.page ?? undefined,
                terms: quoteTerms(evidence.quote ?? ''),
              })
            }
          >
            {m.imports_evidence_open()}
          </Button>
        ) : url ? (
          <Button
            variant="link"
            className="h-auto p-0 text-xs"
            nativeButton={false}
            render={
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                aria-label={m.imports_evidence_open()}
              />
            }
          >
            {m.imports_evidence_open()}
            <ExternalLink aria-hidden />
          </Button>
        ) : null}
      </div>
      {fileItemId ? <PreviewDialog target={preview.target} {...preview.props} /> : null}
    </>
  )
}

/** "Where this came from": the page and quote the value was read from (M08 §6.2). */
export function EvidenceButton({ evidence, field }: { evidence?: EvidenceData; field: string }) {
  if (!evidence?.quote) return null
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={m.imports_evidence_aria({ field })}
                  className="text-muted-foreground"
                />
              }
            />
          }
        >
          <Quote aria-hidden />
        </TooltipTrigger>
        <TooltipContent>{m.imports_evidence()}</TooltipContent>
      </Tooltip>
      <PopoverContent className="w-80 space-y-2 text-sm">
        {evidence.page ? (
          <p className="text-xs text-muted-foreground">
            {m.imports_evidence_page({ page: evidence.page })}
          </p>
        ) : null}
        <SourceQuote evidence={evidence} />
      </PopoverContent>
    </Popover>
  )
}

/** Beside a field's label in an opened item: this value is worth a look. */
export function UnsureIcon({ unsure }: { unsure: boolean }) {
  if (!unsure) return null
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex text-warning" />}>
        <ScanSearch aria-hidden className="size-3.5" />
        <span className="sr-only">{m.imports_unsure()}</span>
      </TooltipTrigger>
      <TooltipContent>{m.imports_unsure()}</TooltipContent>
    </Tooltip>
  )
}

/**
 * A value of a collapsed row that was read uncertainly (M08 §6.2): underlined with a small mark,
 * so it is seen without opening the row. Hovering shows where it was read; "Looks right" keeps it
 * as it is (it is no longer marked), "Edit" opens the row. Nothing stops importing it unchecked.
 */
export function UnsureMark({
  item,
  fields,
  editable,
  onEdit,
  children,
}: {
  item: ImportItem
  /** The fields this cell shows. */
  fields: readonly string[]
  editable: boolean
  onEdit: () => void
  children: ReactNode
}) {
  const save = useItemUpdate({ onError: toastError })
  const unsure = item.decision === 'accept' && !item.result ? unsureFields(item, fields) : []
  if (unsure.length === 0) return children
  const evidence = unsure.map((field) => item.evidence[field]).find((e) => e?.quote)
  const confirm = () => {
    // Saving a value as it is clears its mark (the server keeps marks only for unedited values).
    const data = Object.fromEntries(unsure.map((field) => [field, item.data[field] ?? null]))
    void trackEdit(
      save
        .mutateAsync({ path: { session_id: item.session_id, item_id: item.id }, body: { data } })
        .catch(() => undefined), // reported by onError
    )
  }
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={200}
        onClick={(event) => event.stopPropagation()}
        render={
          // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- labelled by the value it wraps
          <button
            type="button"
            className="inline-flex max-w-full items-center gap-1 rounded-sm text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        }
      >
        <span className="truncate underline decoration-warning decoration-dotted decoration-2 underline-offset-4">
          {children}
        </span>
        <ScanSearch aria-hidden className="size-3.5 shrink-0 text-warning" />
        <span className="sr-only">{m.imports_unsure()}</span>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 space-y-2 text-sm"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="flex items-center gap-1.5 text-xs font-medium text-warning">
          <ScanSearch aria-hidden className="size-3.5" />
          {evidence?.page ? m.imports_unsure_page({ page: evidence.page }) : m.imports_unsure()}
        </p>
        {evidence ? <SourceQuote evidence={evidence} /> : null}
        {editable ? (
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={onEdit}>
              {m.imports_unsure_edit()}
            </Button>
            <Button variant="outline" size="sm" disabled={save.isPending} onClick={confirm}>
              {m.imports_unsure_ok()}
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
