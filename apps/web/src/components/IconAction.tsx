import type { ComponentProps, ReactNode } from 'react'
import { Button } from '@/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'

/** An icon button with its name in a tooltip; `tooltip` is shorter text when the name is long. */
export function IconAction({
  label,
  tooltip,
  children,
  ...props
}: { label: string; tooltip?: string; children: ReactNode } & ComponentProps<typeof Button>) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label={label} {...props} />}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{tooltip ?? label}</TooltipContent>
    </Tooltip>
  )
}
