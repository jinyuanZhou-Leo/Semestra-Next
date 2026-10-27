import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { type ColorRef, ColorPicker } from './ColorPicker'

/**
 * A color in a settings table row: a small button with a dot in the current color and a chevron,
 * so it reads as something to change without hovering, that opens the `ColorPicker`.
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
            <PopoverTrigger
              render={
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={label}
                  className="gap-1.5 rounded-3xl px-2.5"
                />
              }
            />
          }
        >
          <span
            aria-hidden
            className={cn(
              'size-4 rounded-full',
              color ? 'ring-1 ring-foreground/10' : 'border border-dashed border-muted-foreground',
            )}
            style={color ? { backgroundColor: color } : undefined}
          />
          <ChevronDown aria-hidden className="size-4 text-muted-foreground" />
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <PopoverContent align="start" className="w-auto max-w-80">
        <ColorPicker
          menu
          label={label}
          inheritLabel={inheritLabel}
          value={value}
          onChange={onChange}
        />
      </PopoverContent>
    </Popover>
  )
}
