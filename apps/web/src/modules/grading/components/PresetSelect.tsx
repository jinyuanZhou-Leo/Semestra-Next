import { m } from '@/paraglide/messages'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'

/** Ids the backend offers (`presets.PRESET_IDS`); the texts live here. */
const PRESET_LABELS: Record<string, () => string> = {
  uoft_4_0: () => m.grading_preset_uoft_4_0(),
  us_4_0: () => m.grading_preset_us_4_0(),
  cn_100: () => m.grading_preset_cn_100(),
  custom: () => m.grading_preset_custom(),
}

export const presetLabel = (id: string) => PRESET_LABELS[id]?.() ?? id

/** Picks one of the built-in conversion tables. */
export function PresetSelect({
  value,
  ids,
  onChange,
  label,
  className,
}: {
  value: string
  ids: readonly string[]
  onChange: (id: string) => void
  label: string
  className?: string
}) {
  const items = ids.map((id) => ({ value: id, label: presetLabel(id) }))
  return (
    <Select value={value} items={items} onValueChange={(next) => next && onChange(String(next))}>
      <SelectTrigger aria-label={label} className={className ?? 'w-56'}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
