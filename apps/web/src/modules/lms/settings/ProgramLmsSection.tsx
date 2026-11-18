import {
  lmsConnectionListOptions,
  lmsProgramBindingClearMutation,
  lmsProgramBindingGetOptions,
  lmsProgramBindingSetMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link2 } from 'lucide-react'
import { useId, useState } from 'react'
import type { SettingsSectionProps } from '@/app/extensions'
import { ChoiceControl } from '@/app/settings/choice'
import { Switch } from '@/ui/switch'
import {
  SettingRow,
  SettingsBlock,
  SettingsGroup,
  SettingsNote,
  useSettingsDialog,
} from '@/app/settings'
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
import { useProviderUis } from '../providers'
import { invalidateLms } from '../queries'
import { ConnectionStatus } from './ConnectionsSection'

const NONE = 'none'

/** Opens account settings on the LMS connections, e.g. from a Program without one. */
export function useOpenConnections() {
  const settings = useSettingsDialog()
  return () => settings.open({ level: 'account', group: 'lms', section: 'lms-connections' })
}

/**
 * Program settings → LMS (M09 §7.1): the connection the Program's courses link through. It can
 * only change while no course is linked, since links belong to that connection's courses.
 */
export function ProgramLmsSection({ scope }: SettingsSectionProps) {
  const programId = scope?.programId ?? ''
  const queryClient = useQueryClient()
  const openConnections = useOpenConnections()
  const uis = useProviderUis()
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
          { value: NONE, label: m.lms_binding_none(), Logo: null },
          ...data.items.map((c) => ({
            value: c.id,
            label: c.display_name,
            Logo: uis.get(c.provider)?.logo ?? Link2,
          })),
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
                            {item.Logo ? <item.Logo aria-hidden /> : null}
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
            {bound ? <MaterialDefaults provider={uis.get(bound.provider)?.label() ?? ''} /> : null}
          </div>
        )
      }}
    </AsyncBoundary>
  )
}

/**
 * SAMPLE (PR 3): how the Program's courses take in materials, unless a course sets its own. The
 * real rows come from the settings namespace (Program and course levels), like every two-level
 * setting.
 */
function MaterialDefaults({ provider }: { provider: string }) {
  const [sync, setSync] = useState(true)
  const [store, setStore] = useState<'read' | 'stored'>('read')
  const syncId = useId()
  const storeId = useId()
  return (
    <div className="pt-4">
      <SettingsBlock title={m.lms_materials_group()}>
        <SettingsGroup>
      <SettingRow
        label={m.lms_course_files_sync()}
        description={m.lms_program_files_sync_description({ provider })}
        htmlFor={syncId}
      >
        <Switch id={syncId} checked={sync} onCheckedChange={setSync} />
      </SettingRow>
      <SettingRow label={m.lms_course_files_store()} labelId={storeId}>
        <ChoiceControl
          labelId={storeId}
          value={store}
          disabled={!sync}
          selectClassName="w-56"
          options={[
            {
              value: 'read',
              label: m.lms_course_files_store_read(),
              hint: m.lms_course_files_store_read_hint({ provider }),
            },
            {
              value: 'stored',
              label: m.lms_course_files_store_stored(),
              hint: m.lms_course_files_store_stored_hint({ provider }),
            },
          ]}
          onChange={setStore}
        />
      </SettingRow>
        </SettingsGroup>
      </SettingsBlock>
    </div>
  )
}
