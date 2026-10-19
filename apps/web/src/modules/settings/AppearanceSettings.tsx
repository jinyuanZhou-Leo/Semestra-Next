import { useId } from 'react'
import { ACCENTS, type Accent, type ReduceMotion, type Theme } from '@/app/appearance'
import { usePreferences, useUpdatePreferences } from '@/app/preferences'
import { useTheme } from '@/app/theme'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Field, FieldContent, FieldLabel, FieldTitle } from '@/ui/field'
import { SettingRow, SettingsGroup } from '@/app/settings'
import { RadioGroup, RadioGroupItem } from '@/ui/radio-group'
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group'

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

/** A miniature window painted with the theme's own tokens (forced with `.light` / `.dark`). */
function MiniWindow({ mode }: { mode: 'light' | 'dark' }) {
  return (
    <div className={cn(mode, 'h-full w-full bg-background p-2')} aria-hidden>
      <div className="mb-1.5 h-1.5 w-8 rounded-full bg-foreground/70" />
      <div className="mb-1 h-1 w-full rounded-full bg-muted-foreground/40" />
      <div className="mb-2 h-1 w-3/4 rounded-full bg-muted-foreground/40" />
      <div className="h-3 w-8 rounded-full bg-primary" />
    </div>
  )
}

function ThemePreview({ theme }: { theme: Theme }) {
  if (theme === 'system') {
    return (
      <div className="grid h-full grid-cols-2">
        <MiniWindow mode="light" />
        <MiniWindow mode="dark" />
      </div>
    )
  }
  return <MiniWindow mode={theme} />
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
          className="grid w-full grid-cols-3 gap-3 sm:w-96"
        >
          {THEMES.map((option) => (
            <FieldLabel
              key={option}
              htmlFor={`${id}-theme-${option}`}
              className="*:data-[slot=field]:p-3"
            >
              <Field orientation="horizontal">
                <FieldContent className="min-w-0">
                  <span className="block h-14 overflow-hidden rounded-xl border">
                    <ThemePreview theme={option} />
                  </span>
                  <FieldTitle>{THEME_LABELS[option]()}</FieldTitle>
                </FieldContent>
                <RadioGroupItem value={option} id={`${id}-theme-${option}`} />
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
          className="flex w-auto flex-wrap gap-2"
        >
          {ACCENTS.map((option) => (
            <RadioGroupItem
              key={option}
              value={option}
              data-accent={option}
              aria-label={ACCENT_LABELS[option]()}
              title={ACCENT_LABELS[option]()}
              className="size-8 bg-primary ring-offset-2 ring-offset-background data-checked:ring-2 data-checked:ring-primary"
            />
          ))}
        </RadioGroup>
      </SettingRow>
      <SettingRow
        label={m.settings_motion_label()}
        labelId={`${id}-motion`}
        description={m.settings_motion_description()}
      >
        <ToggleGroup
          aria-labelledby={`${id}-motion`}
          value={[motion]}
          onValueChange={(next) => {
            const value = next[0] as ReduceMotion | undefined
            if (!value) return
            applied.setReduceMotion(value)
            update({ reduce_motion: value })
          }}
          variant="outline"
          size="sm"
        >
          {MOTIONS.map((option) => (
            <ToggleGroupItem key={option.value} value={option.value}>
              {option.label()}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </SettingRow>
    </SettingsGroup>
  )
}
