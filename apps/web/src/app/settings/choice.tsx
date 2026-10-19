import { SEGMENT, SEGMENTED } from '@/lib/segmented'
import { cn } from '@/lib/utils'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group'

export type ChoiceOption<T extends string> = {
  value: T
  label: string
  /** One line on what picking it does; any option with one turns the control into a select. */
  hint?: string
}

/**
 * The control for a one-of-several setting (round-4 rule): up to four short options with no
 * explanation are a segmented control; options that need a line of explanation, or more than
 * four, are a select whose items carry that line, so the choice says what it does.
 */
export function ChoiceControl<T extends string>({
  options,
  value,
  onChange,
  labelId,
  label,
  id,
  className,
}: {
  options: readonly ChoiceOption<T>[]
  value: T
  onChange: (value: T) => void
  /** The visible name of the setting; or `label` when there is none to point at. */
  labelId?: string
  label?: string
  id?: string
  /** Width of the select trigger. */
  className?: string
}) {
  const pick = (next: unknown) => {
    const option = options.find((o) => o.value === next)
    if (option) onChange(option.value)
  }
  if (options.length <= 4 && options.every((o) => !o.hint)) {
    return (
      <ToggleGroup
        id={id}
        aria-labelledby={labelId}
        aria-label={label}
        value={[value]}
        onValueChange={(next) => pick(next[0])}
        size="sm"
        className={SEGMENTED}
      >
        {options.map((o) => (
          <ToggleGroupItem key={o.value} value={o.value} className={SEGMENT}>
            {o.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    )
  }
  return (
    <Select
      value={value}
      items={options.map((o) => ({ value: o.value, label: o.label }))}
      onValueChange={pick}
    >
      <SelectTrigger
        id={id}
        aria-labelledby={labelId}
        aria-label={label}
        className={cn('w-56', className)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="w-72">
        <SelectGroup>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.hint ? (
                <span className="flex flex-col gap-0.5 whitespace-normal">
                  {o.label}
                  <span className="text-xs font-normal text-muted-foreground">{o.hint}</span>
                </span>
              ) : (
                o.label
              )}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
