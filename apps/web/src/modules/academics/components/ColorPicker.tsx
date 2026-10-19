import type { HexColor, PaletteColor } from '@semestra/api-client'
import { Link2, Pipette } from 'lucide-react'
import type { CSSProperties } from 'react'
import { SUBJECT_PALETTE_SIZE, subjectColor } from '@/lib/subject-color'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { RadioGroup, RadioGroupItem } from '@/ui/radio-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'

export type ColorRef = PaletteColor | HexColor

const SLOTS = Array.from({ length: SUBJECT_PALETTE_SIZE }, (_, i) => i + 1)

const INHERIT = 'inherit'

/** Every swatch is the same circle; the chosen one gets a ring with a gap, like the others. */
const SWATCH =
  'size-7 border-foreground/10 ring-offset-2 ring-offset-background after:inset-0 data-checked:ring-2 data-checked:ring-primary'

/** A follow-something swatch whose color varies (each course its own): a wheel of the palette. */
const PALETTE_WHEEL = `conic-gradient(${SLOTS.map((slot) => `var(--subject-${slot})`).join(', ')}, var(--subject-1))`

function selectedValue(color: ColorRef | null): string | null {
  if (color == null) return INHERIT
  return 'palette' in color ? String(color.palette) : null
}

/**
 * A course or subject color (M02 §5.5): one of the 12 palette slots, a custom hex color, or
 * (with `inheritLabel`) no own color so a higher one applies. That choice is a swatch like the
 * others, filled with the color it follows (`inheritColor`) and marked with a link.
 */
export function ColorPicker({
  value,
  onChange,
  inheritLabel,
  inheritColor,
  label,
}: {
  value: ColorRef | null
  onChange: (value: ColorRef | null) => void
  inheritLabel?: string
  /** The CSS color the inherit swatch follows; a palette wheel when it differs per item. */
  inheritColor?: string
  label: string
}) {
  const hex = value != null && 'hex' in value ? value.hex : null
  const inheritStyle: CSSProperties = inheritColor
    ? { backgroundColor: inheritColor }
    : { backgroundImage: PALETTE_WHEEL }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <RadioGroup
        aria-label={label}
        className="flex w-auto flex-wrap items-center gap-2"
        value={selectedValue(value)}
        onValueChange={(next) => onChange(next === INHERIT ? null : { palette: Number(next) })}
      >
        {inheritLabel ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="relative mr-1 flex">
                  <RadioGroupItem
                    value={INHERIT}
                    aria-label={inheritLabel}
                    className={SWATCH}
                    style={inheritStyle}
                  />
                  {/* The link mark gives way to the checked dot. */}
                  <Link2
                    aria-hidden
                    className="pointer-events-none absolute inset-0 m-auto size-3.5 text-background drop-shadow-sm peer-data-checked:hidden"
                  />
                </span>
              }
            />
            <TooltipContent>{inheritLabel}</TooltipContent>
          </Tooltip>
        ) : null}
        {SLOTS.map((slot) => (
          <RadioGroupItem
            key={slot}
            value={String(slot)}
            aria-label={m.academics_color_slot({ slot })}
            className={SWATCH}
            style={{ backgroundColor: subjectColor(`subject-${slot}`) }}
          />
        ))}
      </RadioGroup>
      <Tooltip>
        <TooltipTrigger
          render={
            // The color input covers the whole swatch, so a plain span is enough to hold it.
            <span
              className={cn(
                'relative flex size-7 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-dashed border-border ring-offset-2 ring-offset-background focus-within:ring-2 focus-within:ring-ring',
                hex && 'border-solid border-foreground/10 ring-2 ring-primary',
              )}
              style={hex ? { backgroundColor: hex } : undefined}
            />
          }
        >
          {hex ? null : <Pipette aria-hidden className="size-3.5 text-muted-foreground" />}
          <input
            type="color"
            aria-label={m.academics_color_custom()}
            className="absolute inset-0 cursor-pointer opacity-0"
            value={hex ?? '#3b82f6'}
            onChange={(event) => onChange({ hex: event.target.value })}
          />
        </TooltipTrigger>
        <TooltipContent>{m.academics_color_custom()}</TooltipContent>
      </Tooltip>
    </div>
  )
}
