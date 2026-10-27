import { agentPreferenceGetOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink, KeyRound } from 'lucide-react'
import { useState } from 'react'
import {
  ActionRow,
  ChoiceControl,
  SettingRow,
  SettingsBlock,
  SettingsGroup,
  SettingsNote,
  useSettingsDialog,
} from '@/app/settings'
import { apiUrl } from '@/lib/api-extras'
import { docsUrl } from '@/lib/docs'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
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

/** The MCP server (M12 §5): its address and client setups; the catalog lives in the docs. */
export function McpSection() {
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
      <SettingsGroup>
        <SettingRow
          label={m.assistant_mcp_reference()}
          description={m.assistant_mcp_reference_description()}
        >
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={
              <a
                href={docsUrl('mcp/tools')}
                target="_blank"
                rel="noreferrer noopener"
                aria-label={m.assistant_mcp_reference_open()}
              />
            }
          >
            {m.assistant_mcp_reference_open()}
            <ExternalLink aria-hidden />
          </Button>
        </SettingRow>
      </SettingsGroup>
    </div>
  )
}

/**
 * What MCP clients may do (M12 §6.2): reading needs any API token, changes a read-write token,
 * and deleting also this switch. Asking before each call is up to the client.
 */
export function McpPermissionsSection() {
  const preferences = useQuery(agentPreferenceGetOptions())
  const update = useUpdatePreferences()
  const settings = useSettingsDialog()
  return (
    <div className="space-y-3">
      <SettingsGroup>
        <SettingRow
          label={m.assistant_permissions_read()}
          description={m.assistant_mcp_read_description()}
        >
          <span className="text-sm text-muted-foreground">{m.assistant_mcp_allowed()}</span>
        </SettingRow>
        <SettingRow
          label={m.assistant_permissions_write()}
          description={m.assistant_mcp_write_description()}
        >
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              settings.open({ level: 'account', group: 'security', section: 'tokens' })
            }
          >
            <KeyRound aria-hidden />
            {m.assistant_mcp_manage_tokens()}
          </Button>
        </SettingRow>
        <SettingRow
          label={m.assistant_permissions_destructive()}
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
      </SettingsGroup>
      <SettingsNote>{m.assistant_mcp_permissions_note()}</SettingsNote>
    </div>
  )
}
