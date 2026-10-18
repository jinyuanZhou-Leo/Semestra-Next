import type { HexColor, PaletteColor } from '@semestra/api-client'
import { Check } from 'lucide-react'
import { useId } from 'react'
import { SUBJECT_PALETTE_SIZE, subjectColor } from '@/lib/subject-color'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'

export type ColorRef = PaletteColor | HexColor

const SLOTS = Array.from({ length: SUBJECT_PALETTE_SIZE }, (_, i) => i + 1)

function isPalette(color: ColorRef | null, slot: number) {
  return color != null && 'palette' in color && color.palette === slot
}

const SWATCH =
  'flex size-7 cursor-pointer items-center justify-center rounded-full ring-offset-2 ring-offset-background peer-focus-visible:ring-2 peer-focus-visible:ring-ring'

/**
 * A course or subject color (M02 §5.5): one of the 12 palette slots, a custom hex color, or
 * (with `inheritLabel`) no own color so the subject's color applies.
 */
export function ColorPicker({
  value,
  onChange,
  inheritLabel,
  label,
}: {
  value: ColorRef | null
  onChange: (value: ColorRef | null) => void
  inheritLabel?: string
  label: string
}) {
  const name = useId()
  const hex = value != null && 'hex' in value ? value.hex : null
  return (
    <fieldset className="flex flex-wrap items-center gap-1.5">
      <legend className="sr-only">{label}</legend>
      {inheritLabel ? (
        <label className="relative">
          <input
            type="radio"
            name={name}
            className="peer sr-only"
            checked={value == null}
            onChange={() => onChange(null)}
          />
          <span
            className={cn(
              'flex h-7 cursor-pointer items-center rounded-4xl border px-2.5 text-xs ring-offset-2 ring-offset-background peer-focus-visible:ring-2 peer-focus-visible:ring-ring',
              value == null
                ? 'border-primary text-foreground'
                : 'border-border text-muted-foreground',
            )}
          >
            {inheritLabel}
          </span>
        </label>
      ) : null}
      {SLOTS.map((slot) => {
        const checked = isPalette(value, slot)
        return (
          <label key={slot} className="relative">
            <input
              type="radio"
              name={name}
              className="peer sr-only"
              aria-label={m.academics_color_slot({ slot })}
              checked={checked}
              onChange={() => onChange({ palette: slot })}
            />
            <span
              aria-hidden
              className={cn(SWATCH, checked && 'ring-2 ring-primary')}
              style={{ backgroundColor: subjectColor(`subject-${slot}`) }}
            >
              {checked ? <Check className="size-3.5 text-white" /> : null}
            </span>
          </label>
        )
      })}
      <label
        className={cn(
          'relative flex size-7 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-dashed border-border ring-offset-2 ring-offset-background focus-within:ring-2 focus-within:ring-ring',
          hex && 'border-solid ring-2 ring-primary',
        )}
        style={hex ? { backgroundColor: hex } : undefined}
        title={m.academics_color_custom()}
      >
        {hex ? null : (
          <span aria-hidden className="text-xs text-muted-foreground">
            #
          </span>
        )}
        <input
          type="color"
          aria-label={m.academics_color_custom()}
          className="absolute inset-0 cursor-pointer opacity-0"
          value={hex ?? '#3b82f6'}
          onChange={(event) => onChange({ hex: event.target.value })}
        />
      </label>
    </fieldset>
  )
}
