import { cn } from '@/lib/utils'
import { RadioGroup, RadioItem } from '@/ui/radio-group'

type Option<T extends string> = { value: T; label: string }

/** A few mutually exclusive choices shown side by side (arrow keys move the selection). */
export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  className,
  ...aria
}: {
  value: T
  onValueChange: (value: T) => void
  options: readonly Option<T>[]
  className?: string
  'aria-labelledby'?: string
  'aria-label'?: string
}) {
  return (
    <RadioGroup
      value={value}
      onValueChange={(next) => onValueChange(next as T)}
      className={cn('gap-0.5 rounded-4xl bg-muted p-0.5', className)}
      {...aria}
    >
      {options.map((option) => (
        <RadioItem
          key={option.value}
          value={option.value}
          className="rounded-4xl px-3 py-1 text-sm text-muted-foreground transition-colors data-checked:bg-background data-checked:text-foreground data-checked:shadow-sm"
        >
          {option.label}
        </RadioItem>
      ))}
    </RadioGroup>
  )
}
