import { XIcon } from 'lucide-react'
import type { ComponentProps } from 'react'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { SheetClose, SheetContent } from '@/ui/sheet'

/**
 * `SheetContent` with a translated close button. The generated one hardcodes the English
 * "Close" label, so we switch its button off and render our own.
 */
export function AppSheetContent({
  showCloseButton = true,
  children,
  ...props
}: ComponentProps<typeof SheetContent>) {
  return (
    <SheetContent showCloseButton={false} {...props}>
      {children}
      {showCloseButton && (
        <SheetClose
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
        </SheetClose>
      )}
    </SheetContent>
  )
}
