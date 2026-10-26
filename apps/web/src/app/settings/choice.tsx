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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'

export type ChoiceOption<T extends string> = {
  value: T
  label: string
  /** One line on what picking it does; any option with one turns the control into a select. */
  hint?: string
  /** Shown when it is the value, but cannot be picked (a select only). */
  disabled?: boolean
}

/**
 * A first choice that stands for "follow the level above" (M11 §5.2). It is a state of its own,
 * not one of the values, so it does not count towards the four segments.
 */
export type FollowChoice = {
  selected: boolean
  /** The segment's text, e.g. "Follow". */
  short: string
  /** Where the value comes from and what it is: the segment's tooltip and the select item. */
  full: string
  onSelect: () => void
}

const FOLLOW = '__follow__'

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
  disabled,
  selectClassName,
  follow,
}: {
  options: readonly ChoiceOption<T>[]
  value: T
  onChange: (value: T) => void
  /** The visible name of the setting; or `label` when there is none to point at. */
  labelId?: string
  label?: string
  id?: string
  disabled?: boolean
  /** Width of the select trigger; ignored by the segmented form. */
  selectClassName?: string
  follow?: FollowChoice
}) {
  const shown = follow?.selected ? FOLLOW : value
  const pick = (next: unknown) => {
    if (next === FOLLOW) {
      if (follow) follow.onSelect()
      return
    }
    const option = options.find((o) => o.value === next)
    if (option) onChange(option.value)
  }
  if (options.length <= 4 && options.every((o) => !o.hint)) {
    return (
      <ToggleGroup
        id={id}
        aria-labelledby={labelId}
        aria-label={label}
        disabled={disabled}
        value={[shown]}
        onValueChange={(next) => pick(next[0])}
        size="sm"
        className={SEGMENTED}
      >
        {follow ? (
          <Tooltip>
            <TooltipTrigger render={<ToggleGroupItem value={FOLLOW} className={SEGMENT} />}>
              {follow.short}
            </TooltipTrigger>
            <TooltipContent>{follow.full}</TooltipContent>
          </Tooltip>
        ) : null}
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
      value={shown}
      items={[
        ...(follow ? [{ value: FOLLOW, label: follow.full }] : []),
        ...options.map((o) => ({ value: o.value, label: o.label })),
      ]}
      onValueChange={pick}
      disabled={disabled}
    >
      <SelectTrigger
        id={id}
        aria-labelledby={labelId}
        aria-label={label}
        className={cn('w-56', selectClassName)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="w-72">
        <SelectGroup>
          {follow ? <SelectItem value={FOLLOW}>{follow.full}</SelectItem> : null}
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value} disabled={o.disabled}>
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
