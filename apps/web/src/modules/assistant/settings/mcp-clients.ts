import cursorLogo from '@lobehub/icons-static-svg/icons/cursor.svg?url'
import lmstudioLogo from '@lobehub/icons-static-svg/icons/lmstudio.svg?url'
import claudecodeLogo from '@lobehub/icons-static-svg/icons/claudecode.svg?url'
import geminicliLogo from '@lobehub/icons-static-svg/icons/geminicli.svg?url'
import githubcopilotLogo from '@lobehub/icons-static-svg/icons/githubcopilot.svg?url'
import claudeLogo from '@lobehub/icons-static-svg/icons/claude.svg?url'
import codexLogo from '@lobehub/icons-static-svg/icons/codex.svg?url'
import devinLogo from '@lobehub/icons-static-svg/icons/devin.svg?url'

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
  /** The docs page for this client, under `mcp/`. */
  docs: string
  /**
   * Its one-colour mark; VS Code's MCP support is GitHub Copilot's, so it takes that one. None
   * for `other`: any client or script, named by the user.
   */
  logo: string | null
}

export const MCP_CLIENTS: readonly McpClient[] = [
  { id: 'cursor', name: 'Cursor', docs: 'mcp/cursor', logo: cursorLogo },
  { id: 'lm-studio', name: 'LM Studio', docs: 'mcp/lm-studio', logo: lmstudioLogo },
  {
    id: 'claude-code',
    name: 'Claude Code',
    docs: 'mcp/claude-code',
    logo: claudecodeLogo,
  },
  {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    docs: 'mcp/gemini-cli',
    logo: geminicliLogo,
  },
  { id: 'vscode', name: 'VS Code', docs: 'mcp/vscode', logo: githubcopilotLogo },
  {
    id: 'claude-desktop',
    name: 'Claude Desktop',
    docs: 'mcp/claude-desktop',
    logo: claudeLogo,
  },
  { id: 'codex', name: 'Codex', docs: 'mcp/codex', logo: codexLogo },
  { id: 'devin', name: 'Devin Desktop', docs: 'mcp/devin', logo: devinLogo },
  { id: 'other', name: '', docs: 'mcp/other', logo: null },
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
        // The app's own scheme: an https link would send the token to lmstudio.ai.
        href: `lmstudio://add_mcp?name=${SERVER}&config=${encodeURIComponent(base64({ url, headers }))}`,
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
        text: `gemini mcp add --scope user --transport http ${SERVER} ${url} \\\n  --header "Authorization: Bearer ${token}"`,
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

/** The client a token was made for, from its name ("Cursor"); none for tokens named otherwise. */
export function clientOfToken(name: string): McpClient | undefined {
  return MCP_CLIENTS.find((c) => c.name !== '' && c.name === name)
}
