import { ChevronLeft, ChevronRight, Minus, Plus } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Separator } from '@/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'

/** Zoom steps of the PDF viewer's buttons, as a share of the width that fits the window. */
export const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] as const
/** The range the zoom can be set to: typed, or by Ctrl/⌘ + the mouse wheel. */
export const MIN_ZOOM = 0.25
export const MAX_ZOOM = 5

export function clampZoom(zoom: number) {
  return Math.min(Math.max(zoom, MIN_ZOOM), MAX_ZOOM)
}

/** The next step above or below `zoom`; none when it is already at the end. */
function stepFrom(zoom: number, direction: 1 | -1) {
  const eps = 0.001
  return direction > 0
    ? ZOOM_STEPS.find((z) => z > zoom + eps)
    : ZOOM_STEPS.findLast((z) => z < zoom - eps)
}

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
  // What the zoom box shows while it is being edited; otherwise it follows the zoom.
  const [zoomDraft, setZoomDraft] = useState<string | null>(null)
  const applyZoom = () => {
    const n = Number(zoomDraft?.replace('%', ''))
    if (onZoom && Number.isFinite(n) && n > 0) onZoom(clampZoom(n / 100))
    setZoomDraft(null)
  }
  const smaller = zoom === undefined ? undefined : stepFrom(zoom, -1)
  const larger = zoom === undefined ? undefined : stepFrom(zoom, 1)
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
            disabled={smaller === undefined}
            onClick={() => onZoom(smaller ?? zoom)}
          >
            <Minus aria-hidden />
          </IconButton>
          <Tooltip>
            <form
              onSubmit={(event) => {
                event.preventDefault()
                applyZoom()
              }}
            >
              <TooltipTrigger
                render={
                  <input
                    aria-label={m.files_preview_zoom()}
                    inputMode="numeric"
                    className="h-7 w-14 rounded-md bg-transparent text-center text-sm text-muted-foreground tabular-nums outline-none hover:bg-muted hover:text-foreground focus:bg-muted focus:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
                    value={zoomDraft ?? `${Math.round(zoom * 100)}%`}
                    onFocus={(event) => {
                      setZoomDraft(event.target.value)
                      event.target.select()
                    }}
                    onChange={(event) => setZoomDraft(event.target.value)}
                    onBlur={applyZoom}
                  />
                }
              />
            </form>
            <TooltipContent>{m.files_preview_zoom_hint()}</TooltipContent>
          </Tooltip>
          <IconButton
            label={m.files_preview_zoom_in()}
            disabled={larger === undefined}
            onClick={() => onZoom(larger ?? zoom)}
          >
            <Plus aria-hidden />
          </IconButton>
        </>
      ) : null}
    </div>
  )
}
