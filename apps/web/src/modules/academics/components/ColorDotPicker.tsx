import { cn } from '@/lib/utils'
import { Button } from '@/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { type ColorRef, ColorPicker } from './ColorPicker'

/**
 * A color in a settings table row: a dot in the current color that opens the `ColorPicker`.
 * `color` is the CSS color to show; null shows an empty, dashed dot (e.g. "follow the course").
 */
export function ColorDotPicker({
  label,
  color,
  value,
  onChange,
  inheritLabel,
}: {
  label: string
  color: string | null
  value: ColorRef | null
  onChange: (value: ColorRef | null) => void
  inheritLabel?: string
}) {
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger render={<Button variant="ghost" size="icon-sm" aria-label={label} />} />
          }
        >
          <span
            aria-hidden
            className={cn(
              'size-5 rounded-full',
              color ? 'ring-1 ring-foreground/10' : 'border border-dashed border-muted-foreground',
            )}
            style={color ? { backgroundColor: color } : undefined}
          />
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <PopoverContent align="start" className="w-auto max-w-80">
        <ColorPicker label={label} inheritLabel={inheritLabel} value={value} onChange={onChange} />
      </PopoverContent>
    </Popover>
  )
}
