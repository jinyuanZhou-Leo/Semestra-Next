import { useId } from 'react'
import { ACCENTS, type Accent, type ReduceMotion, type Theme } from '@/app/appearance'
import { usePreferences, useUpdatePreferences } from '@/app/preferences'
import { useTheme } from '@/app/theme'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Field, FieldContent, FieldLabel, FieldTitle } from '@/ui/field'
import { ChoiceControl, SettingRow, SettingsGroup } from '@/app/settings'
import { RadioGroup, RadioGroupItem } from '@/ui/radio-group'

const THEMES: readonly Theme[] = ['system', 'light', 'dark']

const THEME_LABELS: Record<Theme, () => string> = {
  system: m.settings_theme_system,
  light: m.settings_theme_light,
  dark: m.settings_theme_dark,
}

export const ACCENT_LABELS: Record<Accent, () => string> = {
  neutral: m.settings_accent_neutral,
  blue: m.settings_accent_blue,
  violet: m.settings_accent_violet,
  green: m.settings_accent_green,
  orange: m.settings_accent_orange,
  rose: m.settings_accent_rose,
  teal: m.settings_accent_teal,
  amber: m.settings_accent_amber,
}

const MOTIONS: readonly { value: ReduceMotion; label: () => string }[] = [
  { value: 'system', label: m.settings_motion_system },
  { value: 'on', label: m.settings_motion_on },
  { value: 'off', label: m.settings_motion_off },
]

const TINT = 'transition-colors duration-300'

/**
 * A miniature app window painted with the theme's own tokens (forced with `.light` / `.dark`). The
 * inner `data-accent` element gives the preview the chosen accent in either theme: the forced theme
 * class alone would fall back to the default blue.
 */
function MiniWindow({
  mode,
  accent,
  className,
}: {
  mode: 'light' | 'dark'
  accent: Accent
  className?: string
}) {
  return (
    <div className={cn(mode, 'absolute inset-0', className)} aria-hidden>
      <div data-accent={accent} className="flex h-full bg-background">
        <div className="flex w-[23%] flex-col gap-[5px] border-r border-sidebar-border bg-sidebar px-[5px] py-1.5">
          <div className={cn('mb-[3px] size-[9px] rounded-[3px] bg-primary', TINT)} />
          <div className={cn('relative h-[5px] rounded-full bg-primary/25 delay-75', TINT)}>
            <div
              className={cn(
                'absolute top-[1px] left-[1.5px] size-[3px] rounded-full bg-primary',
                TINT,
              )}
            />
          </div>
          <div className="h-[5px] rounded-full bg-muted-foreground/30" />
          <div className="h-[5px] rounded-full bg-muted-foreground/30" />
        </div>
        <div className="flex flex-1 flex-col gap-1.5 px-2 py-[7px]">
          <div className="flex items-center justify-between">
            <div className="h-1 w-[30px] rounded-full bg-foreground/75" />
            <div className={cn('h-[7px] w-[15px] rounded-full bg-primary/20 delay-100', TINT)} />
          </div>
          <div className="flex flex-col gap-[3px] rounded-[5px] border bg-card p-[5px]">
            <div className="h-[3px] w-4/5 rounded-full bg-muted-foreground/45" />
            <div className="h-[3px] w-[55%] rounded-full bg-muted-foreground/45" />
            <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-muted">
              <div className={cn('h-full w-[64%] rounded-full bg-primary delay-150', TINT)} />
            </div>
          </div>
          <div className={cn('h-[9px] w-6 rounded-full bg-primary delay-200', TINT)} />
        </div>
      </div>
    </div>
  )
}

/** "Follow system" shows both themes, split along a slanted edge (light on the left). */
function ThemePreview({ theme, accent }: { theme: Theme; accent: Accent }) {
  if (theme === 'system') {
    return (
      <>
        <MiniWindow mode="dark" accent={accent} />
        <MiniWindow
          mode="light"
          accent={accent}
          className="[clip-path:polygon(0_0,60%_0,40%_100%,0_100%)]"
        />
      </>
    )
  }
  return <MiniWindow mode={theme} accent={accent} />
}

export default function AppearanceSettings() {
  return (
    <AsyncBoundary query={usePreferences()}>
      {(prefs) => (
        <AppearanceForm theme={prefs.theme} accent={prefs.accent} motion={prefs.reduce_motion} />
      )}
    </AsyncBoundary>
  )
}

function AppearanceForm({
  theme,
  accent,
  motion,
}: {
  theme: Theme
  accent: Accent
  motion: ReduceMotion
}) {
  const id = useId()
  const update = useUpdatePreferences()
  const applied = useTheme()

  return (
    <SettingsGroup>
      <SettingRow label={m.settings_theme_label()} labelId={`${id}-theme`}>
        <RadioGroup
          aria-labelledby={`${id}-theme`}
          value={theme}
          onValueChange={(next) => {
            applied.setTheme(next as Theme)
            update({ theme: next as Theme })
          }}
          className="grid w-full grid-cols-3 gap-3 sm:w-[28rem]"
        >
          {THEMES.map((option) => (
            <FieldLabel
              key={option}
              htmlFor={`${id}-theme-${option}`}
              className="transition-colors duration-300 *:data-[slot=field]:p-3 has-data-checked:border-primary/60 has-data-checked:bg-primary/5"
            >
              <Field>
                <FieldContent className="min-w-0">
                  <span className="relative block aspect-8/5 overflow-hidden rounded-xl border">
                    <ThemePreview theme={option} accent={accent} />
                  </span>
                </FieldContent>
                <span className="flex items-center justify-between gap-2">
                  <FieldTitle>{THEME_LABELS[option]()}</FieldTitle>
                  <RadioGroupItem value={option} id={`${id}-theme-${option}`} />
                </span>
              </Field>
            </FieldLabel>
          ))}
        </RadioGroup>
      </SettingRow>
      <SettingRow label={m.settings_accent_label()} labelId={`${id}-accent`}>
        <RadioGroup
          aria-labelledby={`${id}-accent`}
          value={accent}
          onValueChange={(next) => {
            applied.setAccent(next as Accent)
            update({ accent: next as Accent })
          }}
          className="flex w-auto flex-wrap gap-2 p-1"
        >
          {ACCENTS.map((option) => (
            <RadioGroupItem
              key={option}
              value={option}
              data-accent={option}
              aria-label={ACCENT_LABELS[option]()}
              title={ACCENT_LABELS[option]()}
              className="accent-swatch size-8 bg-primary transition-transform duration-300 hover:scale-105 data-checked:scale-95"
            />
          ))}
        </RadioGroup>
      </SettingRow>
      <SettingRow
        label={m.settings_motion_label()}
        labelId={`${id}-motion`}
        description={m.settings_motion_description()}
      >
        <ChoiceControl
          labelId={`${id}-motion`}
          options={MOTIONS.map((o) => ({ value: o.value, label: o.label() }))}
          value={motion}
          onChange={(value) => {
            applied.setReduceMotion(value)
            update({ reduce_motion: value })
          }}
        />
      </SettingRow>
    </SettingsGroup>
  )
}
