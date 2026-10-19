import {
  agentPreferencesGetOptions,
  agentToolsCatalogOptions,
} from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { SettingRow, SettingsBlock, SettingsGroup, SettingsNote } from '@/app/settings'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { m } from '@/paraglide/messages'
import { Checkbox } from '@/ui/checkbox'
import { capabilityTitle } from '../labels'
import { useToolGroups, useUpdatePreferences } from './shared'

/**
 * Which changes the assistant may make without a confirmation card (M12 §6.2): write tools by
 * module. Deleting always asks.
 */
export function ApprovalsSection() {
  const catalog = useQuery(agentToolsCatalogOptions())
  const preferences = useQuery(agentPreferencesGetOptions())
  const update = useUpdatePreferences()
  const writes = (catalog.data?.items ?? []).filter((tool) => tool.effect === 'write')
  const groups = useToolGroups(writes)
  const chosen = new Set(preferences.data?.auto_approve ?? [])

  return (
    <AsyncBoundary query={preferences}>
      {() => (
        <div className="space-y-6">
          {groups.map((group) => (
            <SettingsBlock key={group.id} title={group.title}>
              <SettingsGroup>
                {group.tools.map((tool) => (
                  <SettingRow
                    key={tool.name}
                    label={capabilityTitle(tool.name)}
                    description={tool.summary}
                  >
                    {(labelId) => (
                      <Checkbox
                        aria-labelledby={labelId}
                        checked={chosen.has(tool.name)}
                        onCheckedChange={(checked) => {
                          const next = new Set(chosen)
                          if (checked) next.add(tool.name)
                          else next.delete(tool.name)
                          update({ auto_approve: [...next].toSorted() })
                        }}
                      />
                    )}
                  </SettingRow>
                ))}
              </SettingsGroup>
            </SettingsBlock>
          ))}
          <SettingsNote>{m.assistant_settings_approvals_note()}</SettingsNote>
        </div>
      )}
    </AsyncBoundary>
  )
}
