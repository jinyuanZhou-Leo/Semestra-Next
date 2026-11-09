import { agentPreferenceGetOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { SettingRow, SettingsGroup, SettingsNote } from '@/app/settings'
import { apiUrl } from '@/lib/api-extras'
import { docsUrl } from '@/lib/docs'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { CodeBlock, CodeBlockActions, CodeBlockContent, CodeBlockCopyButton } from '@/ui/code-block'
import { Switch } from '@/ui/switch'
import { useUpdatePreferences } from './shared'

/** The MCP server (M12 §5): its address and the catalog in the docs. */
export function McpSection() {
  // Clients run outside the browser: same-origin deployments need the page's origin.
  const url = new URL(apiUrl('/mcp'), window.location.origin).href

  return (
    <>
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
    </>
  )
}

/**
 * What MCP clients may do (M12 §6.2): reading needs any API token, changes a read-write token,
 * and deleting also this switch. Asking before each call is up to the client.
 */
export function McpPermissionsSection() {
  const preferences = useQuery(agentPreferenceGetOptions())
  const update = useUpdatePreferences()
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
          <span className="text-sm text-muted-foreground">{m.assistant_mcp_allowed()}</span>
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
