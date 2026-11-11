import { PanelLeft, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/ui/dialog'
import { Separator } from '@/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'

/**
 * The frame every file preview shares (course files, Canvas files), M07 §6.1: a large dialog
 * whose top bar has the name and "PDF document · 2.4 MB", then the file's actions (open, download;
 * the last one primary), then the tools for reading it (view switch, search), then close. Below:
 * an optional contents panel on the left, the file, and an optional panel on the right (search
 * results).
 */
export function PreviewShell({
  open,
  onOpenChange,
  onOpenChangeComplete,
  title,
  meta,
  actions,
  tools,
  sidebar,
  sidebarOpen = false,
  onSidebarOpenChange,
  aside,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Forget the file once the dialog has closed (`useDialogTarget`), not before. */
  onOpenChangeComplete?: (open: boolean) => void
  title: string
  meta?: string | null
  /** What can be done with the file: secondary buttons first, the main one (download) last. */
  actions?: ReactNode
  /** How to read it: the view switch and the search box, next to each other. */
  tools?: ReactNode
  /** The left panel (contents); with it comes a button to show or hide it. */
  sidebar?: ReactNode
  sidebarOpen?: boolean
  onSidebarOpenChange?: (open: boolean) => void
  /** The right panel, shown while there is something in it (search results). */
  aside?: ReactNode
  children: ReactNode
}) {
  const sidebarLabel = sidebarOpen
    ? m.files_preview_hide_contents()
    : m.files_preview_show_contents()
  return (
    <Dialog open={open} onOpenChange={onOpenChange} onOpenChangeComplete={onOpenChangeComplete}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[calc(100dvh-3rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(96rem,calc(100vw-3rem))]"
      >
        <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
          {sidebar ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={sidebarLabel}
                    aria-pressed={sidebarOpen}
                    className="aria-pressed:bg-muted"
                    onClick={() => onSidebarOpenChange?.(!sidebarOpen)}
                  />
                }
              >
                <PanelLeft aria-hidden />
              </TooltipTrigger>
              <TooltipContent>{sidebarLabel}</TooltipContent>
            </Tooltip>
          ) : null}
          <div className="ml-1 min-w-0 flex-1">
            <DialogTitle className="truncate text-base">{title}</DialogTitle>
            <DialogDescription className="min-h-4 truncate text-xs">
              {meta || ' '}
            </DialogDescription>
          </div>
          {actions}
          {actions && tools ? (
            <Separator
              orientation="vertical"
              className="mx-1 data-vertical:h-5 data-vertical:self-center"
            />
          ) : null}
          {tools}
          <DialogClose
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="ml-1 bg-secondary"
                aria-label={m.common_close()}
              />
            }
          >
            <X aria-hidden />
          </DialogClose>
        </header>
        <div className="flex min-h-0 flex-1">
          {sidebar && sidebarOpen ? (
            <aside className="flex w-64 shrink-0 flex-col border-r animate-in duration-200 fade-in-0 slide-in-from-left-4">
              {sidebar}
            </aside>
          ) : null}
          <div className="relative flex min-w-0 flex-1 flex-col bg-muted/50">{children}</div>
          {aside ? (
            <aside className="flex w-80 shrink-0 flex-col border-l animate-in duration-200 fade-in-0 slide-in-from-right-4">
              {aside}
            </aside>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
