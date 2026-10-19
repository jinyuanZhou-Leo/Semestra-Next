import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/select'
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

function Dot({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="inline-block size-2.5 shrink-0 self-center rounded-full"
      style={{ backgroundColor: categoryColor(color) }}
    />
  )
}

/** One of the built-in category colors; a custom `#rrggbb` is kept as it is. */
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
      <SelectTrigger aria-label={label} className="w-36">
        <SelectValue>
          {(selected: string) => (
            <span className="flex items-center gap-2">
              <Dot color={selected} />
              {items.find((i) => i.value === selected)?.label ?? selected}
            </span>
          )}
        </SelectValue>
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
