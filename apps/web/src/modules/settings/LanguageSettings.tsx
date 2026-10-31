import { useId } from 'react'
import { usePreferences, useUpdatePreferences } from '@/app/preferences'
import { type AppLocale, useLocale } from '@/app/locale'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { m } from '@/paraglide/messages'
import { ChoiceControl, SettingRow, SettingsGroup } from '@/app/settings'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/select'

type TimeFormat = 'auto' | '12h' | '24h'
type WeekStart = '0' | '1' | '7'

/** Language names are shown in their own language so they stay findable. */
const LANGUAGES: readonly { value: AppLocale | 'browser'; label: () => string }[] = [
  { value: 'browser', label: m.settings_language_browser },
  { value: 'en', label: () => 'English' },
  { value: 'zh-CN', label: () => '简体中文' },
]

const TIME_FORMATS: readonly { value: TimeFormat; label: () => string }[] = [
  { value: 'auto', label: m.settings_time_format_auto },
  { value: '12h', label: m.settings_time_format_12h },
  { value: '24h', label: m.settings_time_format_24h },
]

const WEEK_STARTS: readonly { value: WeekStart; label: () => string }[] = [
  { value: '0', label: m.settings_week_start_auto },
  { value: '1', label: m.settings_week_start_monday },
  { value: '7', label: m.settings_week_start_sunday },
]

export default function LanguageSettings() {
  return (
    <AsyncBoundary query={usePreferences()}>
      {(prefs) => <LanguageForm prefs={prefs} />}
    </AsyncBoundary>
  )
}

function LanguageForm({
  prefs,
}: {
  prefs: { locale: AppLocale | null; time_format: TimeFormat; week_start: 0 | 1 | 7 }
}) {
  const id = useId()
  const update = useUpdatePreferences()
  const { changeLocale } = useLocale()

  return (
    <SettingsGroup>
      <SettingRow
        label={m.settings_language_label()}
        labelId={`${id}-language`}
        htmlFor={`${id}-language-select`}
      >
        <Select
          value={prefs.locale ?? 'browser'}
          items={LANGUAGES.map((l) => ({ value: l.value, label: l.label() }))}
          onValueChange={(next) => {
            const locale = next === 'browser' ? null : (next as AppLocale)
            changeLocale(locale)
            update({ locale })
          }}
        >
          <SelectTrigger id={`${id}-language-select`} aria-labelledby={`${id}-language`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {LANGUAGES.map((l) => (
                <SelectItem key={l.value} value={l.value}>
                  {l.label()}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </SettingRow>
      <SettingRow label={m.settings_time_format_label()} labelId={`${id}-time`}>
        <ChoiceControl
          labelId={`${id}-time`}
          options={TIME_FORMATS.map((o) => ({ value: o.value, label: o.label() }))}
          value={prefs.time_format}
          onChange={(time_format) => update({ time_format })}
        />
      </SettingRow>
      <SettingRow label={m.settings_week_start_label()} labelId={`${id}-week`}>
        <ChoiceControl
          labelId={`${id}-week`}
          options={WEEK_STARTS.map((o) => ({ value: o.value, label: o.label() }))}
          value={String(prefs.week_start) as WeekStart}
          onChange={(next) => update({ week_start: Number(next) as 0 | 1 | 7 })}
        />
      </SettingRow>
    </SettingsGroup>
  )
}
