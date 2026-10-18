import { XIcon } from 'lucide-react'
import type { ComponentProps } from 'react'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { DialogClose, DialogContent } from '@/ui/dialog'

/**
 * `DialogContent` with a translated close button. The generated one hardcodes the English
 * "Close" label, so we switch its button off and render our own.
 */
export function AppDialogContent({
  showCloseButton = true,
  children,
  ...props
}: ComponentProps<typeof DialogContent>) {
  return (
    <DialogContent showCloseButton={false} {...props}>
      {children}
      {showCloseButton && (
        <DialogClose
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="absolute top-4 right-4 bg-secondary"
            />
          }
        >
          <XIcon />
          <span className="sr-only">{m.common_close()}</span>
        </DialogClose>
      )}
    </DialogContent>
  )
}
