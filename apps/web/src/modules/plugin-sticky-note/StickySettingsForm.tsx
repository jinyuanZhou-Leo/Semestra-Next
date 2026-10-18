import { useId } from 'react'
import { m } from '@/paraglide/messages'
import { RadioGroup, RadioItem } from '@/ui/radio-group'
import { colorTint } from '../plugin-kit/colors'
import { NOTE_COLORS, type StickySettings } from './schema'

type Props = { value: StickySettings; onChange: (value: StickySettings) => void }

const NAMES: Record<(typeof NOTE_COLORS)[number], () => string> = {
  'subject-3': m.sticky_color_subject_3,
  'subject-4': m.sticky_color_subject_4,
  'subject-7': m.sticky_color_subject_7,
  'subject-8': m.sticky_color_subject_8,
  'subject-10': m.sticky_color_subject_10,
  'subject-11': m.sticky_color_subject_11,
}

/** Settings of a sticky note: only its color (the text is edited on the card). */
export default function StickySettingsForm({ value, onChange }: Props) {
  const id = useId()
  return (
    <div>
      <p id={id} className="mb-2 text-sm font-medium">
        {m.sticky_settings_color_label()}
      </p>
      <RadioGroup
        aria-labelledby={id}
        value={value.color}
        onValueChange={(color) => onChange({ ...value, color: color as StickySettings['color'] })}
        className="flex-wrap"
      >
        {NOTE_COLORS.map((color) => (
          <RadioItem
            key={color}
            value={color}
            aria-label={NAMES[color]()}
            title={NAMES[color]()}
            className="size-8 rounded-lg border border-border ring-offset-2 ring-offset-background data-checked:ring-2 data-checked:ring-foreground/60"
            style={{ backgroundColor: colorTint(color, 40) }}
          />
        ))}
      </RadioGroup>
    </div>
  )
}
