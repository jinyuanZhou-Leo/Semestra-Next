import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/select'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { categoryColor } from '../display'

export const CATEGORY_COLORS = [
  'blue',
  'amber',
  'emerald',
  'violet',
  'cyan',
  'rose',
  'slate',
] as const

const COLOR_LABELS: Record<(typeof CATEGORY_COLORS)[number], () => string> = {
  blue: () => m.grading_color_blue(),
  amber: () => m.grading_color_amber(),
  emerald: () => m.grading_color_emerald(),
  violet: () => m.grading_color_violet(),
  cyan: () => m.grading_color_cyan(),
  rose: () => m.grading_color_rose(),
  slate: () => m.grading_color_slate(),
}

function Dot({ color, large }: { color: string; large?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block shrink-0 self-center rounded-full',
        large ? 'size-4 ring-1 ring-foreground/10' : 'size-2.5',
      )}
      style={{ backgroundColor: categoryColor(color) }}
    />
  )
}

/**
 * One of the built-in category colors, shown as a dot; a custom `#rrggbb` is kept as it is.
 */
export function CategoryColorSelect({
  value,
  onChange,
  label,
}: {
  value: string
  onChange: (color: string) => void
  label: string
}) {
  const items = CATEGORY_COLORS.map((c) => ({ value: c as string, label: COLOR_LABELS[c]() }))
  if (!items.some((i) => i.value === value)) items.push({ value, label: value })
  return (
    <Select value={value} items={items} onValueChange={(next) => next && onChange(String(next))}>
      <SelectTrigger
        aria-label={label}
        title={items.find((i) => i.value === value)?.label ?? value}
        className="w-auto gap-1.5 bg-transparent hover:bg-muted"
      >
        {/* Only the dot: the table row has no room for the name, the list shows it. */}
        <SelectValue>{(selected: string) => <Dot color={selected} large />}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              <Dot color={item.value} />
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
