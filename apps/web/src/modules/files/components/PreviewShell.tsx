import type { ReactNode } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog'

/**
 * The frame every file preview shares (course files, Canvas files): the name and "PDF document ·
 * 2.4 MB" on top, the file, and its actions as buttons in the footer (the last one primary).
 */
export function PreviewShell({
  open,
  onOpenChange,
  onOpenChangeComplete,
  title,
  meta,
  footer,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Forget the file once the dialog has closed (`useDialogTarget`), not before. */
  onOpenChangeComplete?: (open: boolean) => void
  title: string
  meta?: string | null
  /** Buttons in the footer: secondary ones `outline`, the main one (download) last. */
  footer?: ReactNode
  children: ReactNode
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} onOpenChangeComplete={onOpenChangeComplete}>
      <DialogContent className="flex h-[85vh] flex-col gap-3 sm:max-w-5xl">
        <DialogHeader className="pr-8">
          <DialogTitle className="truncate">{title}</DialogTitle>
          <DialogDescription className="min-h-5 truncate">{meta || ' '}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
        {footer ? <DialogFooter>{footer}</DialogFooter> : null}
      </DialogContent>
    </Dialog>
  )
}
