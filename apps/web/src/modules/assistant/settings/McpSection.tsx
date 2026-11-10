import { agentPreferenceGetOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { Check, Copy, ExternalLink } from 'lucide-react'
import { useId, useState } from 'react'
import { SettingRow, SettingsGroup, SettingsNote } from '@/app/settings'
import { apiUrl } from '@/lib/api-extras'
import { copyText } from '@/lib/clipboard'
import { docsUrl } from '@/lib/docs'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/ui/input-group'
import { Switch } from '@/ui/switch'
import { useUpdatePreferences } from './shared'

/** The MCP server (M12 §5): its address and the catalog in the docs. */
export function McpSection() {
  // Clients run outside the browser: same-origin deployments need the page's origin.
  const url = new URL(apiUrl('/mcp'), window.location.origin).href
  const labelId = useId()
  const [copied, setCopied] = useState(false)
  const copy = () =>
    copyText(url).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      },
      () => toastError(new Error('clipboard')),
    )

  return (
    <>
      <SettingsGroup>
        <SettingRow
          label={m.assistant_mcp_endpoint()}
          description={m.assistant_mcp_endpoint_description()}
          labelId={labelId}
        >
          <InputGroup className="w-72">
            <InputGroupInput
              readOnly
              value={url}
              aria-labelledby={labelId}
              onFocus={(e) => e.target.select()}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                aria-label={copied ? m.common_copied() : m.common_copy()}
                size="icon-xs"
                onClick={copy}
              >
                {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
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
