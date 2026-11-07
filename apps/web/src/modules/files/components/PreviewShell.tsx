import type { ComponentProps, ReactNode } from 'react'
import { Button } from '@/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'

/**
 * The frame every file preview shares (course files, Canvas files): the name and "PDF document ·
 * 2.4 MB" on the left, the file's actions as icon buttons on the right, the file below.
 */
export function PreviewShell({
  open,
  onClose,
  title,
  meta,
  actions,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  meta?: string | null
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex h-[85vh] flex-col gap-3 sm:max-w-5xl">
        <DialogHeader className="flex-row items-center gap-2 pr-8">
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate">{title}</DialogTitle>
            <DialogDescription className="min-h-5 truncate">{meta || ' '}</DialogDescription>
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </DialogContent>
    </Dialog>
  )
}

/** An icon button in the preview's header, named by its tooltip. */
export function PreviewAction({
  label,
  children,
  ...props
}: { label: string; children: ReactNode } & ComponentProps<typeof Button>) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label={label} {...props} />}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
