import cursorLogo from '@lobehub/icons-static-svg/icons/cursor.svg?url'
import lmstudioLogo from '@lobehub/icons-static-svg/icons/lmstudio.svg?url'
import claudecodeLogo from '@lobehub/icons-static-svg/icons/claudecode.svg?url'
import geminicliLogo from '@lobehub/icons-static-svg/icons/geminicli.svg?url'
import githubcopilotLogo from '@lobehub/icons-static-svg/icons/githubcopilot.svg?url'
import claudeLogo from '@lobehub/icons-static-svg/icons/claude.svg?url'
import openaiLogo from '@lobehub/icons-static-svg/icons/openai.svg?url'
import codexLogo from '@lobehub/icons-static-svg/icons/codex.svg?url'
import devinLogo from '@lobehub/icons-static-svg/icons/devin.svg?url'
import type { TokenOut } from '@semestra/api-client'
import { m } from '@/paraglide/messages'

/**
 * How each MCP client connects to Semestra (M12 §5): apps such as ChatGPT and Claude sign in
 * (OAuth) from the server address alone; the rest take an API token through an install link, a
 * terminal command, or a config file to paste into. Checked against each client's docs on
 * 2026-11-14; the docs site has the same steps (`apps/docs/content/docs/mcp/`).
 */

/** Clients that connect by signing in. */
export type SignInClientId = 'chatgpt' | 'claude'

/** Clients that connect with an API token. */
export type TokenClientId =
  | 'cursor'
  | 'lm-studio'
  | 'claude-code'
  | 'gemini-cli'
  | 'vscode'
  | 'codex'
  | 'devin'
  | 'other'

export type ClientId = SignInClientId | TokenClientId

export type Setup =
  /** An install link the client opens itself, with a config file as the fallback. */
  | { kind: 'link'; href: string; file: string; text: string }
  | { kind: 'command'; text: string }
  | { kind: 'config'; file: string; text: string }
  /** Any other client: the address and the token, typed in by hand. */
  | { kind: 'manual' }

/** The "+" button in a menu path. */
export const PLUS = Symbol('plus')

/** Where a sign-in app adds a server, and what to do once it is pasted. */
export interface SignIn {
  /** The app's own menu path, from where its window starts. */
  menu: () => readonly (string | typeof PLUS)[]
  /** The step after pasting the address. */
  add: () => string
}

interface BaseClient {
  name: string
  /** The docs page for this client, under `mcp/`. */
  docs: string
  /**
   * Its one-colour mark; VS Code's MCP support is GitHub Copilot's, so it takes that one. None
   * for `other`: any client or script, named by the user.
   */
  logo: string | null
}

export type McpClient =
  | (BaseClient & { id: SignInClientId; signIn: SignIn })
  | (BaseClient & { id: TokenClientId; signIn?: undefined })

export const MCP_CLIENTS: readonly McpClient[] = [
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    docs: 'mcp/chatgpt',
    logo: openaiLogo,
    signIn: {
      menu: () => [
        m.assistant_mcp_chatgpt_menu_plugins(),
        PLUS,
        m.assistant_mcp_chatgpt_menu_add(),
      ],
      add: m.assistant_mcp_chatgpt_add,
    },
  },
  {
    id: 'claude',
    name: 'Claude',
    docs: 'mcp/claude',
    logo: claudeLogo,
    signIn: {
      menu: () => [
        m.assistant_mcp_claude_menu_customize(),
        m.assistant_mcp_claude_menu_connectors(),
        m.assistant_mcp_claude_menu_add(),
      ],
      add: m.assistant_mcp_claude_add,
    },
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    docs: 'mcp/claude-code',
    logo: claudecodeLogo,
  },
  { id: 'cursor', name: 'Cursor', docs: 'mcp/cursor', logo: cursorLogo },
  { id: 'vscode', name: 'VS Code', docs: 'mcp/vscode', logo: githubcopilotLogo },
  { id: 'codex', name: 'Codex', docs: 'mcp/codex', logo: codexLogo },
  {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    docs: 'mcp/gemini-cli',
    logo: geminicliLogo,
  },
  { id: 'devin', name: 'Devin Desktop', docs: 'mcp/devin', logo: devinLogo },
  { id: 'lm-studio', name: 'LM Studio', docs: 'mcp/lm-studio', logo: lmstudioLogo },
  { id: 'other', name: '', docs: 'mcp/other', logo: null },
]

/**
 * The clients this server can offer: ChatGPT and Claude reach it from their own servers, so they
 * need an address on the internet over HTTPS (a local one is left out).
 */
export function availableClients(url: string): readonly McpClient[] {
  const reachable = new URL(url).protocol === 'https:'
  return MCP_CLIENTS.filter((c) => reachable || !c.signIn)
}

const SERVER = 'semestra'

const json = (value: unknown) => JSON.stringify(value, null, 2)

/** Base64 of a JSON value; the config holds only ASCII (a URL and a token). */
const base64 = (value: unknown) => btoa(JSON.stringify(value))

export function mcpSetup(client: TokenClientId, url: string, token: string): Setup {
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

/**
 * The client a connection belongs to: an app that signed in only when the server knows it is
 * that app (any app can call itself ChatGPT); a pasted token by the name it was made with
 * ("Cursor"). None for connections named otherwise.
 */
export function clientOf(
  connection: Pick<TokenOut, 'kind' | 'app' | 'name'>,
): McpClient | undefined {
  if (connection.kind === 'oauth') return MCP_CLIENTS.find((c) => c.id === connection.app)
  return MCP_CLIENTS.find((c) => !c.signIn && c.name !== '' && c.name === connection.name)
}
