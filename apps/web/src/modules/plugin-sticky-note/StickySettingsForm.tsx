import type { CSSProperties } from 'react'
import { SettingRow, SettingsGroup } from '@/app/settings'
import { m } from '@/paraglide/messages'
import { ColorSwatch } from '@/components/ColorSwatch'
import { RadioGroup } from '@/ui/radio-group'
import { colorTint, colorVar } from '../plugin-kit/colors'
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
  return (
    <SettingsGroup>
      <SettingRow label={m.sticky_settings_color_label()}>
        {(labelId) => (
          <RadioGroup
            aria-labelledby={labelId}
            value={value.color}
            onValueChange={(color) =>
              onChange({ ...value, color: color as StickySettings['color'] })
            }
            className="flex flex-wrap gap-2"
          >
            {NOTE_COLORS.map((color) => (
              <ColorSwatch
                key={color}
                value={color}
                aria-label={NAMES[color]()}
                title={NAMES[color]()}
                className="rounded-lg border-border"
                color={colorTint(color, 40)}
                checkColor="var(--foreground)"
                // The ring is the full color; the fill stays the soft tint.
                style={{ '--swatch-color': colorVar(color) } as CSSProperties}
              />
            ))}
          </RadioGroup>
        )}
      </SettingRow>
    </SettingsGroup>
  )
}
