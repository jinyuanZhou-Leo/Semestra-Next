import { ChevronLeft, ChevronRight, Minus, Plus } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Separator } from '@/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'

/** Zoom steps of the PDF viewer, as a share of the width that fits the window. */
export const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3] as const

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="rounded-full"
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * The floating bar at the bottom of a preview: previous / page box / next, and for PDFs the zoom
 * (the percentage resets it to the window's width).
 */
export function PageControls({
  page,
  total,
  onPage,
  zoom,
  onZoom,
}: {
  page: number
  /** 0 while the page count is not known yet. */
  total: number
  onPage: (page: number) => void
  zoom?: number
  onZoom?: (zoom: number) => void
}) {
  // What the page box shows while it is being edited; otherwise it follows the page.
  const [draft, setDraft] = useState<string | null>(null)
  const step = zoom === undefined ? -1 : ZOOM_STEPS.findIndex((z) => z >= zoom)
  return (
    <div className="absolute bottom-5 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full bg-popover p-1 shadow-lg ring-1 ring-foreground/10 animate-in duration-200 fade-in-0 slide-in-from-bottom-2">
      <IconButton
        label={m.files_preview_previous_page()}
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        <ChevronLeft aria-hidden />
      </IconButton>
      <form
        className="flex items-center gap-1"
        onSubmit={(event) => {
          event.preventDefault()
          const n = Number(draft)
          if (Number.isInteger(n) && total > 0) onPage(Math.min(Math.max(n, 1), total))
          setDraft(null)
        }}
      >
        <input
          aria-label={m.files_preview_page()}
          inputMode="numeric"
          className="h-7 w-10 rounded-md bg-muted text-center text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          value={draft ?? String(page)}
          onFocus={(event) => {
            setDraft(event.target.value)
            event.target.select()
          }}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => setDraft(null)}
        />
        <span className="pr-1 text-sm text-muted-foreground tabular-nums">
          {m.files_preview_page_of({ total: total || '…' })}
        </span>
      </form>
      <IconButton
        label={m.files_preview_next_page()}
        disabled={total === 0 || page >= total}
        onClick={() => onPage(page + 1)}
      >
        <ChevronRight aria-hidden />
      </IconButton>
      {zoom !== undefined && onZoom ? (
        <>
          <Separator
            orientation="vertical"
            className="mx-1 data-vertical:h-5 data-vertical:self-center"
          />
          <IconButton
            label={m.files_preview_zoom_out()}
            disabled={step <= 0}
            onClick={() => onZoom(ZOOM_STEPS[Math.max(step - 1, 0)] ?? 1)}
          >
            <Minus aria-hidden />
          </IconButton>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={m.files_preview_zoom_fit()}
                  className="h-7 w-12 rounded-md text-center text-sm text-muted-foreground tabular-nums hover:bg-muted hover:text-foreground"
                  onClick={() => onZoom(1)}
                />
              }
            >
              {Math.round(zoom * 100)}%
            </TooltipTrigger>
            <TooltipContent>{m.files_preview_zoom_fit()}</TooltipContent>
          </Tooltip>
          <IconButton
            label={m.files_preview_zoom_in()}
            disabled={step >= ZOOM_STEPS.length - 1}
            onClick={() => onZoom(ZOOM_STEPS[Math.min(step + 1, ZOOM_STEPS.length - 1)] ?? 1)}
          >
            <Plus aria-hidden />
          </IconButton>
        </>
      ) : null}
    </div>
  )
}
