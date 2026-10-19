import { useParams } from '@tanstack/react-router'
import { m } from '@/paraglide/messages'
import { Field, FieldLabel } from '@/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { useTaskLists } from '../queries'
import { INBOX, SMART_VIEWS } from '../types'
import type { ListCardSettings } from './schema'

/** Which list the list card shows: a smart list, the inbox or one of the Program's lists. */
export default function ListCardSettingsForm({
  value,
  onChange,
}: {
  value: ListCardSettings
  onChange: (value: ListCardSettings) => void
}) {
  const { programId } = useParams({ strict: false }) as { programId?: string }
  const lists = useTaskLists(programId ?? '').data?.items ?? []
  const options = [
    ...SMART_VIEWS.filter((v) => v.view !== 'completed').map((v) => ({
      value: v.view as string,
      label: v.title(),
    })),
    { value: 'inbox', label: INBOX.title() },
    ...lists.map((l) => ({ value: `list:${l.id}`, label: l.name })),
  ]
  return (
    <Field>
      <FieldLabel>{m.settings_card_tasks_list_source_label()}</FieldLabel>
      <Select
        value={value.source}
        items={options}
        onValueChange={(source) => source && onChange({ source })}
      >
        <SelectTrigger className="w-full">
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
    </Field>
  )
}
