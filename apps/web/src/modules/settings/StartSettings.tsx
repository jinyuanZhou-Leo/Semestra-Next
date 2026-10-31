import type { Preferences } from '@semestra/api-client'
import { usePreferences, useUpdatePreferences } from '@/app/preferences'
import { type ChoiceOption, ChoiceControl, SettingRow, SettingsGroup } from '@/app/settings'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { m } from '@/paraglide/messages'

type StartPage = Preferences['start_page']

/** The sidebar's entries, in its order (M02 §5.1); term pages open in the term the sidebar shows. */
const START_PAGES: readonly { value: StartPage; label: () => string; hint?: () => string }[] = [
  { value: 'last', label: m.settings_start_page_last, hint: m.settings_start_page_last_hint },
  { value: 'today', label: m.schedule_today, hint: m.settings_start_page_today_hint },
  { value: 'overview', label: m.academics_nav_overview, hint: m.settings_start_page_overview_hint },
  { value: 'calendar', label: m.schedule_nav_calendar, hint: m.settings_start_page_calendar_hint },
  { value: 'tasks', label: m.tasks_name, hint: m.settings_start_page_tasks_hint },
  { value: 'grades', label: m.grading_nav_grades, hint: m.settings_start_page_grades_hint },
  { value: 'files', label: m.files_nav, hint: m.settings_start_page_files_hint },
  {
    value: 'assistant',
    label: m.academics_nav_assistant,
    hint: m.settings_start_page_assistant_hint,
  },
  { value: 'summary', label: m.academics_nav_summary, hint: m.settings_start_page_summary_hint },
]

export default function StartSettings() {
  return (
    <AsyncBoundary query={usePreferences()}>
      {(prefs) => <StartForm value={prefs.start_page} />}
    </AsyncBoundary>
  )
}

function StartForm({ value }: { value: StartPage }) {
  const update = useUpdatePreferences()
  const options: ChoiceOption<StartPage>[] = START_PAGES.map((o) => ({
    value: o.value,
    label: o.label(),
    hint: o.hint?.(),
  }))
  return (
    <SettingsGroup>
      <SettingRow
        label={m.settings_start_page_label()}
        description={m.settings_start_page_description()}
      >
        {(labelId) => (
          <ChoiceControl
            labelId={labelId}
            options={options}
            value={value}
            onChange={(start_page) => update({ start_page })}
          />
        )}
      </SettingRow>
    </SettingsGroup>
  )
}
