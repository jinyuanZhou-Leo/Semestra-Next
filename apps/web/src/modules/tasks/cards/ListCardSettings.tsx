import type { Scope } from '@/app/extensions'
import { m } from '@/paraglide/messages'
import { SettingRow, SettingsGroup } from '@/app/settings'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { useTaskLists } from '../queries'
import { INBOX, SMART_VIEWS } from '../types'
import type { ListCardSettings } from './schema'

/**
 * Which list the list card shows: a smart list, Unsorted (`inbox`) or one of the Program's lists;
 * on a term's board only that term's and the Program-wide ones.
 */
export default function ListCardSettingsForm({
  value,
  onChange,
  scope,
}: {
  value: ListCardSettings
  onChange: (value: ListCardSettings) => void
  /** The board passes it; optional only in the shared settings-form type. */
  scope?: Scope
}) {
  const termId = scope?.kind === 'term' ? scope.termId : undefined
  const lists = (useTaskLists(scope?.programId ?? '').data?.items ?? []).filter(
    (l) => !termId || l.term_id === null || l.term_id === termId,
  )
  const options = [
    ...SMART_VIEWS.filter((v) => v.view !== 'completed').map((v) => ({
      value: v.view as string,
      label: v.title(),
    })),
    { value: 'inbox', label: INBOX.title() },
    ...lists.map((l) => ({ value: `list:${l.id}`, label: l.name })),
  ]
  return (
    <SettingsGroup>
      <SettingRow label={m.settings_card_tasks_list_source_label()}>
        {(labelId) => (
          <Select
            value={value.source}
            items={options}
            onValueChange={(source) => source && onChange({ source })}
          >
            <SelectTrigger className="w-56" aria-labelledby={labelId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </SettingRow>
    </SettingsGroup>
  )
}
