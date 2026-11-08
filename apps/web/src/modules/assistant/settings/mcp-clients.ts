/**
 * How each MCP client connects to Semestra with an API token (M12 §5): an install link, a
 * terminal command, or a config file to paste into. Checked against each client's docs on
 * 2026-11-08; the docs site has the same steps (`apps/docs/content/docs/mcp/`).
 */

export type ClientId =
  | 'cursor'
  | 'lm-studio'
  | 'claude-code'
  | 'gemini-cli'
  | 'vscode'
  | 'claude-desktop'
  | 'codex'
  | 'devin'
  | 'other'

export type ClientKind = 'link' | 'command' | 'config' | 'manual'

export type Setup =
  /** An install link the client opens itself, with a config file as the fallback. */
  | { kind: 'link'; href: string; file: string; text: string }
  | { kind: 'command'; text: string }
  | { kind: 'config'; file: string; text: string }
  /** Any other client: the address and the token, typed in by hand. */
  | { kind: 'manual' }

export interface McpClient {
  id: ClientId
  name: string
  kind: ClientKind
  /** The docs page for this client, under `mcp/`. */
  docs: string
}

export const MCP_CLIENTS: readonly McpClient[] = [
  { id: 'cursor', name: 'Cursor', kind: 'link', docs: 'mcp/cursor' },
  { id: 'lm-studio', name: 'LM Studio', kind: 'link', docs: 'mcp/lm-studio' },
  { id: 'claude-code', name: 'Claude Code', kind: 'command', docs: 'mcp/claude-code' },
  { id: 'gemini-cli', name: 'Gemini CLI', kind: 'command', docs: 'mcp/gemini-cli' },
  { id: 'vscode', name: 'VS Code', kind: 'config', docs: 'mcp/vscode' },
  { id: 'claude-desktop', name: 'Claude Desktop', kind: 'config', docs: 'mcp/claude-desktop' },
  { id: 'codex', name: 'Codex', kind: 'config', docs: 'mcp/codex' },
  { id: 'devin', name: 'Devin Desktop', kind: 'config', docs: 'mcp/devin' },
  { id: 'other', name: '', kind: 'manual', docs: 'mcp/other' },
]

const SERVER = 'semestra'

const json = (value: unknown) => JSON.stringify(value, null, 2)

/** Base64 of a JSON value; the config holds only ASCII (a URL and a token). */
const base64 = (value: unknown) => btoa(JSON.stringify(value))

export function mcpSetup(client: ClientId, url: string, token: string): Setup {
  const headers = { Authorization: `Bearer ${token}` }
  switch (client) {
    case 'cursor':
      return {
        kind: 'link',
        href: `cursor://anysphere.cursor-deeplink/mcp/install?name=${SERVER}&config=${encodeURIComponent(base64({ url, headers }))}`,
        file: '~/.cursor/mcp.json',
        text: json({ mcpServers: { [SERVER]: { url, headers } } }),
      }
    case 'lm-studio':
      return {
        kind: 'link',
        href: `https://lmstudio.ai/install-mcp?name=${SERVER}&config=${encodeURIComponent(base64({ url, headers }))}`,
        file: '~/.lmstudio/mcp.json',
        text: json({ mcpServers: { [SERVER]: { url, headers } } }),
      }
    case 'claude-code':
      return {
        kind: 'command',
        text: `claude mcp add --transport http ${SERVER} ${url} \\\n  --header "Authorization: Bearer ${token}"`,
      }
    case 'gemini-cli':
      return {
        kind: 'command',
        text: `gemini mcp add --transport http ${SERVER} ${url} \\\n  --header "Authorization: Bearer ${token}"`,
      }
    case 'vscode':
      return {
        kind: 'config',
        file: 'mcp.json',
        text: json({ servers: { [SERVER]: { type: 'http', url, headers } } }),
      }
    case 'claude-desktop':
      // Claude Desktop reads only local (stdio) servers from its config file: mcp-remote bridges
      // to the HTTP server. No space after the colon, safe from argument splitting on Windows.
      return {
        kind: 'config',
        file: 'claude_desktop_config.json',
        text: json({
          mcpServers: {
            [SERVER]: {
              command: 'npx',
              args: ['-y', 'mcp-remote', url, '--header', 'Authorization:${AUTH_HEADER}'],
              env: { AUTH_HEADER: `Bearer ${token}` },
            },
          },
        }),
      }
    case 'codex':
      return {
        kind: 'config',
        file: '~/.codex/config.toml',
        text: `[mcp_servers.${SERVER}]\nurl = "${url}"\nhttp_headers = { Authorization = "Bearer ${token}" }`,
      }
    case 'devin':
      return {
        kind: 'config',
        file: '~/.config/devin/mcp_config.json',
        text: json({ mcpServers: { [SERVER]: { url, transport: 'http', headers } } }),
      }
    case 'other':
      return { kind: 'manual' }
  }
}
