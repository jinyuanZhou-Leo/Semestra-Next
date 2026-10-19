import {
  lmsConnectionListOptions,
  lmsProgramBindingClearMutation,
  lmsProgramBindingGetOptions,
  lmsProgramBindingSetMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link2 } from 'lucide-react'
import type { SettingsSectionProps } from '@/app/extensions'
import { SettingRow, SettingsGroup, SettingsNote, useSettingsDialog } from '@/app/settings'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/ui/empty'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/select'
import { invalidateLms } from '../queries'
import { ConnectionStatus } from './ConnectionsSection'

const NONE = 'none'

/** Opens account settings on the LMS connections, e.g. from a Program without one. */
export function useOpenConnections() {
  const settings = useSettingsDialog()
  return () =>
    settings.open({ level: 'account', group: 'integrations', section: 'lms-connections' })
}

/**
 * Program settings → LMS (M09 §7.1): the connection the Program's courses link through. It can
 * only change while no course is linked, since links belong to that connection's courses.
 */
export function ProgramLmsSection({ scope }: SettingsSectionProps) {
  const programId = scope?.programId ?? ''
  const queryClient = useQueryClient()
  const openConnections = useOpenConnections()
  const connections = useQuery(lmsConnectionListOptions())
  const binding = useQuery(lmsProgramBindingGetOptions({ path: { program_id: programId } }))
  const done = { onSuccess: () => invalidateLms(queryClient), onError: toastError }
  const set = useMutation({ ...lmsProgramBindingSetMutation(), ...done })
  const clear = useMutation({ ...lmsProgramBindingClearMutation(), ...done })

  return (
    <AsyncBoundary
      query={connections}
      isEmpty={(data) => data.items.length === 0}
      empty={
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Link2 aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{m.lms_connections_empty()}</EmptyTitle>
            <EmptyDescription>{m.lms_binding_needs_connection()}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" onClick={openConnections}>
              {m.lms_connection_add()}
            </Button>
          </EmptyContent>
        </Empty>
      }
    >
      {(data) => {
        const current = binding.data
        const linked = current?.link_count ?? 0
        const items = [
          { value: NONE, label: m.lms_binding_none() },
          ...data.items.map((c) => ({ value: c.id, label: c.display_name })),
        ]
        const bound = data.items.find((c) => c.id === current?.connection_id)
        return (
          <div className="space-y-2">
            <SettingsGroup>
              <SettingRow
                label={m.lms_binding_label()}
                description={m.lms_binding_description()}
                note={bound ? <ConnectionStatus connection={bound} /> : undefined}
              >
                {(labelId) => (
                  <Select
                    value={current?.connection_id ?? NONE}
                    items={items}
                    disabled={!current || linked > 0 || set.isPending || clear.isPending}
                    onValueChange={(next) => {
                      if (!next || next === (current?.connection_id ?? NONE)) return
                      if (next === NONE) clear.mutate({ path: { program_id: programId } })
                      else
                        set.mutate({
                          path: { program_id: programId },
                          body: { connection_id: next },
                        })
                    }}
                  >
                    <SelectTrigger aria-labelledby={labelId} className="w-56">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {items.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                )}
              </SettingRow>
            </SettingsGroup>
            {linked > 0 ? (
              <SettingsNote>{m.lms_binding_locked({ count: linked })}</SettingsNote>
            ) : null}
          </div>
        )
      }}
    </AsyncBoundary>
  )
}
