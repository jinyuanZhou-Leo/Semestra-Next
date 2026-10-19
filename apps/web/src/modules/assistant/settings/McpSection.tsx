import { agentPreferencesGetOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { KeyRound } from 'lucide-react'
import { useState } from 'react'
import {
  ActionRow,
  ChoiceControl,
  SettingRow,
  SettingsBlock,
  SettingsGroup,
  useSettingsDialog,
} from '@/app/settings'
import { apiUrl } from '@/lib/api-extras'
import { m } from '@/paraglide/messages'
import { CodeBlock, CodeBlockActions, CodeBlockContent, CodeBlockCopyButton } from '@/ui/code-block'
import { Switch } from '@/ui/switch'
import { useUpdatePreferences } from './shared'

type Client = 'claude-desktop' | 'claude-code' | 'cursor'

const CLIENTS: readonly { id: Client; name: string }[] = [
  { id: 'claude-desktop', name: 'Claude Desktop' },
  { id: 'claude-code', name: 'Claude Code' },
  { id: 'cursor', name: 'Cursor' },
]

/** How to connect each MCP client to `url` with an API token (M12 §5). */
export function mcpConfig(client: Client, url: string, token: string): string {
  if (client === 'claude-code') {
    return `claude mcp add --transport http semestra ${url} \\\n  --header "Authorization: Bearer ${token}"`
  }
  if (client === 'cursor') {
    const config = {
      mcpServers: { semestra: { url, headers: { Authorization: `Bearer ${token}` } } },
    }
    return JSON.stringify(config, null, 2)
  }
  const config = {
    mcpServers: {
      semestra: {
        command: 'npx',
        args: ['-y', 'mcp-remote', url, '--header', 'Authorization:${AUTH_HEADER}'],
        env: { AUTH_HEADER: `Bearer ${token}` },
      },
    },
  }
  return JSON.stringify(config, null, 2)
}

/** The MCP server (M12 §5, §6.2): its address, client setups and whether deleting is allowed. */
export function McpSection() {
  const preferences = useQuery(agentPreferencesGetOptions())
  const update = useUpdatePreferences()
  const settings = useSettingsDialog()
  const [client, setClient] = useState<Client>('claude-desktop')
  // Clients run outside the browser: same-origin deployments need the page's origin.
  const url = new URL(apiUrl('/mcp'), window.location.origin).href
  const config = mcpConfig(client, url, m.assistant_mcp_token_placeholder())

  return (
    <div className="space-y-6">
      <SettingsGroup>
        <SettingRow
          label={m.assistant_mcp_endpoint()}
          description={m.assistant_mcp_endpoint_description()}
        >
          <CodeBlock size="sm" className="w-auto max-w-72">
            <CodeBlockActions>
              <CodeBlockCopyButton value={url} />
            </CodeBlockActions>
            <CodeBlockContent className="pr-10">{url}</CodeBlockContent>
          </CodeBlock>
        </SettingRow>
        <SettingRow
          label={m.assistant_mcp_destructive()}
          description={m.assistant_mcp_destructive_description()}
        >
          {(labelId) => (
            <Switch
              aria-labelledby={labelId}
              disabled={!preferences.data}
              checked={preferences.data?.mcp_allow_destructive ?? false}
              onCheckedChange={(checked) => update({ mcp_allow_destructive: checked })}
            />
          )}
        </SettingRow>
        <ActionRow
          icon={KeyRound}
          onClick={() => settings.open({ level: 'account', group: 'security', section: 'tokens' })}
        >
          {m.assistant_mcp_tokens()}
        </ActionRow>
      </SettingsGroup>
      <SettingsBlock
        title={m.assistant_mcp_setup()}
        description={m.assistant_mcp_setup_description()}
        action={
          <ChoiceControl
            label={m.assistant_mcp_client()}
            options={CLIENTS.map((c) => ({ value: c.id, label: c.name }))}
            value={client}
            onChange={setClient}
          />
        }
      >
        <CodeBlock size="sm">
          <CodeBlockActions>
            <CodeBlockCopyButton value={config} />
          </CodeBlockActions>
          <CodeBlockContent>{config}</CodeBlockContent>
        </CodeBlock>
      </SettingsBlock>
    </div>
  )
}
