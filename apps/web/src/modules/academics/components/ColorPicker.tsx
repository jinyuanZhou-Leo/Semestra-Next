import type { HexColor, PaletteColor } from '@semestra/api-client'
import { useId } from 'react'
import { SUBJECT_PALETTE_SIZE, subjectColor } from '@/lib/subject-color'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Field, FieldLabel } from '@/ui/field'
import { RadioGroup, RadioGroupItem } from '@/ui/radio-group'

export type ColorRef = PaletteColor | HexColor

const SLOTS = Array.from({ length: SUBJECT_PALETTE_SIZE }, (_, i) => i + 1)

const INHERIT = 'inherit'

function selectedValue(color: ColorRef | null): string | null {
  if (color == null) return INHERIT
  return 'palette' in color ? String(color.palette) : null
}

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
  const id = useId()
  const hex = value != null && 'hex' in value ? value.hex : null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <RadioGroup
        aria-label={label}
        className="flex w-auto flex-wrap items-center gap-1.5"
        value={selectedValue(value)}
        onValueChange={(next) => onChange(next === INHERIT ? null : { palette: Number(next) })}
      >
        {inheritLabel ? (
          <Field orientation="horizontal" className="mr-1 w-auto gap-1.5">
            <RadioGroupItem id={`${id}-inherit`} value={INHERIT} />
            <FieldLabel htmlFor={`${id}-inherit`} className="text-xs font-normal">
              {inheritLabel}
            </FieldLabel>
          </Field>
        ) : null}
        {SLOTS.map((slot) => (
          <RadioGroupItem
            key={slot}
            value={String(slot)}
            aria-label={m.academics_color_slot({ slot })}
            className="size-7 ring-offset-2 ring-offset-background after:inset-0 data-checked:ring-2 data-checked:ring-primary"
            style={{ backgroundColor: subjectColor(`subject-${slot}`) }}
          />
        ))}
      </RadioGroup>
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
    </div>
  )
}
