import { Radio as RadioPrimitive } from '@base-ui/react/radio'
import { cn } from '@/lib/utils'

/**
 * A radio that renders as a button-like card: no built-in dot, style it with `data-checked:`.
 * Use inside `RadioGroup` from `@/ui/radio-group` (whose own `RadioGroupItem` draws a dot).
 */
export function RadioCard({ className, ...props }: RadioPrimitive.Root.Props) {
  return (
    <RadioPrimitive.Root
      data-slot="radio-card"
      className={cn(
        'cursor-pointer outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}
