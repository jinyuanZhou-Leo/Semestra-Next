import type { Evidence as EvidenceData } from '@semestra/api-client'
import { ExternalLink, Quote } from 'lucide-react'
import { apiUrl } from '@/lib/api-extras'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'

export type Confidence = 'high' | 'medium' | 'low'

/** A dot beside a field the model was unsure about; nothing for confident or hand-made values. */
export function ConfidenceDot({ confidence }: { confidence?: Confidence }) {
  if (!confidence || confidence === 'high') return null
  const label = confidence === 'low' ? m.imports_confidence_low() : m.imports_confidence_medium()
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn(
              'inline-block size-1.5 shrink-0 rounded-full',
              confidence === 'low' ? 'bg-destructive' : 'bg-muted-foreground/60',
            )}
          />
        }
      >
        <span className="sr-only">{label}</span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** Link to the uploaded file, at the page for PDFs. */
export function sourceUrl(evidence: EvidenceData): string | null {
  if (!evidence.upload_id) return null
  const page = evidence.page ? `#page=${evidence.page}` : ''
  return `${apiUrl(`/imports/uploads/${evidence.upload_id}/content`)}${page}`
}

/** "Where this came from": the page and quote the value was read from (M08 §6.2). */
export function EvidenceButton({ evidence, field }: { evidence?: EvidenceData; field: string }) {
  if (!evidence?.quote) return null
  const url = sourceUrl(evidence)
  const label = m.imports_evidence_aria({ field })
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
                  aria-label={label}
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
        <blockquote className="border-l-2 pl-3 whitespace-pre-wrap text-muted-foreground">
          {evidence.quote}
        </blockquote>
        {url ? (
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
      </PopoverContent>
    </Popover>
  )
}
