import type { Preferences } from '@semestra/api-client'
import {
  ChartColumn,
  CalendarDays,
  FolderOpen,
  History,
  LayoutDashboard,
  ListChecks,
  type LucideIcon,
  MessageCircle,
  NotebookPen,
  Sun,
} from 'lucide-react'
import { usePreferences, useUpdatePreferences } from '@/app/preferences'
import { type ChoiceOption, ChoiceControl, SettingRow, SettingsGroup } from '@/app/settings'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { m } from '@/paraglide/messages'

type StartPage = Preferences['start_page']

/** The sidebar's entries, in its order and with its icons (M02 §5.1). */
const START_PAGES: readonly { value: StartPage; label: () => string; icon: LucideIcon }[] = [
  { value: 'last', label: m.settings_start_page_last, icon: History },
  { value: 'today', label: m.schedule_today, icon: Sun },
  { value: 'overview', label: m.academics_nav_overview, icon: LayoutDashboard },
  { value: 'calendar', label: m.schedule_nav_calendar, icon: CalendarDays },
  { value: 'tasks', label: m.tasks_name, icon: ListChecks },
  { value: 'grades', label: m.grading_nav_grades, icon: NotebookPen },
  { value: 'files', label: m.files_nav, icon: FolderOpen },
  { value: 'assistant', label: m.academics_nav_assistant, icon: MessageCircle },
  { value: 'summary', label: m.academics_nav_summary, icon: ChartColumn },
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
    icon: o.icon,
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
