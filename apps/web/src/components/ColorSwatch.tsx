import type { ComponentProps, CSSProperties } from 'react'
import { cn } from '@/lib/utils'
import { RadioGroupItem } from '@/ui/radio-group'

type Props = Omit<ComponentProps<typeof RadioGroupItem>, 'color'> & {
  /** The CSS color of the swatch; leave it out for the accent (the item's own `--primary`). */
  color?: string
  /** The check's color; it must read on `color` in both themes (default: text on the accent). */
  checkColor?: string
  /** Inside a dropdown or popover: just a ring with a gap, no animation. */
  menu?: boolean
}

/**
 * One color choice in a `RadioGroup`: a circle (or whatever `className` rounds it to) in `color`.
 * Choosing it contracts a ring onto the swatch and draws a check (`.color-swatch` in theme.css);
 * swatches in a dropdown or popover (`menu`) only get a static ring.
 */
export function ColorSwatch({ color, checkColor, menu, className, style, ...props }: Props) {
  const css = {
    ...(color ? { backgroundColor: color, '--swatch-color': color } : null),
    ...(checkColor ? { '--swatch-check': checkColor } : null),
    ...style,
  } as CSSProperties
  return (
    <RadioGroupItem
      {...props}
      className={cn(
        'size-8 bg-primary after:inset-0',
        menu
          ? 'ring-offset-2 ring-offset-background data-checked:ring-2 data-checked:ring-primary'
          : 'color-swatch transition-transform duration-300 hover:scale-105 motion-reduce:transition-none motion-reduce:hover:scale-100 data-checked:bg-clip-content data-checked:p-[3px]',
        className,
      )}
      style={css}
    />
  )
}
