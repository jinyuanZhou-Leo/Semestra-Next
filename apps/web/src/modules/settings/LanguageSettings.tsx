import { useId } from 'react'
import { usePreferences, useUpdatePreferences } from '@/app/preferences'
import { type AppLocale, useLocale } from '@/app/locale'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { SegmentedControl } from '@/components/SegmentedControl'
import { SettingList, SettingRow } from '@/components/SettingRow'
import { m } from '@/paraglide/messages'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'

type TimeFormat = 'auto' | '12h' | '24h'
type WeekStart = '0' | '1' | '7'

/** Language names are shown in their own language so they stay findable. */
const LANGUAGES: readonly { value: AppLocale | 'browser'; label: () => string }[] = [
  { value: 'browser', label: m.settings_language_browser },
  { value: 'en', label: () => 'English' },
  { value: 'zh-CN', label: () => '简体中文' },
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
    <SettingList>
      <SettingRow
        label={m.settings_language_label()}
        labelId={`${id}-language`}
        htmlFor={`${id}-language-select`}
        description={m.settings_language_description()}
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
            {LANGUAGES.map((l) => (
              <SelectItem key={l.value} value={l.value}>
                {l.label()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>
      <SettingRow label={m.settings_time_format_label()} labelId={`${id}-time`}>
        <SegmentedControl<TimeFormat>
          aria-labelledby={`${id}-time`}
          value={prefs.time_format}
          onValueChange={(next) => update({ time_format: next })}
          options={[
            { value: 'auto', label: m.settings_time_format_auto() },
            { value: '12h', label: m.settings_time_format_12h() },
            { value: '24h', label: m.settings_time_format_24h() },
          ]}
        />
      </SettingRow>
      <SettingRow label={m.settings_week_start_label()} labelId={`${id}-week`}>
        <SegmentedControl<WeekStart>
          aria-labelledby={`${id}-week`}
          value={String(prefs.week_start) as WeekStart}
          onValueChange={(next) => update({ week_start: Number(next) as 0 | 1 | 7 })}
          options={[
            { value: '0', label: m.settings_week_start_auto() },
            { value: '1', label: m.settings_week_start_monday() },
            { value: '7', label: m.settings_week_start_sunday() },
          ]}
        />
      </SettingRow>
    </SettingList>
  )
}
