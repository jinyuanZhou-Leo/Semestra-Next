import type { Provider } from '@semestra/api-client'
import { Bot, Gem, type LucideIcon, Plug, PlugZap, Server, Sparkle, Waypoints } from 'lucide-react'
import type { Message } from '@/app/extensions'
import type { AiPurpose } from '@/hooks/use-ai-status'
import { m } from '@/paraglide/messages'

export type ProviderKind = Provider['kind']
export type Capability = Provider['capabilities'][number]

export const KINDS: readonly ProviderKind[] = [
  'anthropic',
  'openai',
  'gemini',
  'openai_compatible',
  'openai_responses',
  'anthropic_compatible',
  'ollama',
]

export const CAPABILITIES: readonly Capability[] = [
  'chat',
  'tools',
  'vision',
  'structured',
  'embedding',
]

type KindInfo = {
  name: Message
  hint: Message
  icon: LucideIcon
  needsKey: boolean
  needsBaseUrl: boolean
  /** The user picks the capabilities (endpoints and local models differ). */
  chooseCapabilities: boolean
  defaultCapabilities: readonly Capability[]
  baseUrlPlaceholder?: string
}

export const KIND_INFO: Record<ProviderKind, KindInfo> = {
  anthropic: {
    name: m.ai_kind_anthropic,
    hint: m.ai_kind_anthropic_hint,
    icon: Sparkle,
    needsKey: true,
    needsBaseUrl: false,
    chooseCapabilities: false,
    defaultCapabilities: [],
  },
  openai: {
    name: m.ai_kind_openai,
    hint: m.ai_kind_openai_hint,
    icon: Bot,
    needsKey: true,
    needsBaseUrl: false,
    chooseCapabilities: false,
    defaultCapabilities: [],
  },
  gemini: {
    name: m.ai_kind_gemini,
    hint: m.ai_kind_gemini_hint,
    icon: Gem,
    needsKey: true,
    needsBaseUrl: false,
    chooseCapabilities: false,
    defaultCapabilities: [],
  },
  openai_compatible: {
    name: m.ai_kind_openai_compatible,
    hint: m.ai_kind_openai_compatible_hint,
    icon: Plug,
    needsKey: false,
    needsBaseUrl: true,
    chooseCapabilities: true,
    defaultCapabilities: ['chat', 'tools'],
    baseUrlPlaceholder: 'https://api.deepseek.com/v1',
  },
  openai_responses: {
    name: m.ai_kind_openai_responses,
    hint: m.ai_kind_openai_responses_hint,
    icon: Waypoints,
    needsKey: false,
    needsBaseUrl: true,
    chooseCapabilities: true,
    defaultCapabilities: ['chat', 'tools', 'structured'],
    baseUrlPlaceholder: 'https://api.openai.com/v1',
  },
  anthropic_compatible: {
    name: m.ai_kind_anthropic_compatible,
    hint: m.ai_kind_anthropic_compatible_hint,
    icon: PlugZap,
    needsKey: false,
    needsBaseUrl: true,
    chooseCapabilities: true,
    defaultCapabilities: ['chat', 'tools'],
    baseUrlPlaceholder: 'https://api.deepseek.com/anthropic',
  },
  ollama: {
    name: m.ai_kind_ollama,
    hint: m.ai_kind_ollama_hint,
    icon: Server,
    needsKey: false,
    needsBaseUrl: true,
    chooseCapabilities: true,
    defaultCapabilities: ['chat', 'tools', 'structured', 'embedding'],
    baseUrlPlaceholder: 'http://localhost:11434',
  },
}

export const PURPOSE_TITLES: Record<AiPurpose, Message> = {
  chat: m.ai_purpose_chat,
  extraction: m.ai_purpose_extraction,
  vision: m.ai_purpose_vision,
  embedding: m.ai_purpose_embedding,
  title: m.ai_purpose_title,
}

export const PURPOSE_HINTS: Record<AiPurpose, Message> = {
  chat: m.ai_purpose_chat_hint,
  extraction: m.ai_purpose_extraction_hint,
  vision: m.ai_purpose_vision_hint,
  embedding: m.ai_purpose_embedding_hint,
  title: m.ai_purpose_title_hint,
}

export const CAPABILITY_TITLES: Record<Capability, Message> = {
  chat: m.ai_capability_chat,
  tools: m.ai_capability_tools,
  vision: m.ai_capability_vision,
  structured: m.ai_capability_structured,
  embedding: m.ai_capability_embedding,
}

/** The capability a provider needs to serve a purpose (mirrors the backend's PURPOSE_NEEDS). */
export const PURPOSE_NEEDS: Record<AiPurpose, Capability> = {
  chat: 'chat',
  extraction: 'chat',
  vision: 'vision',
  embedding: 'embedding',
  title: 'chat',
}

export function canServe(provider: Provider, purpose: AiPurpose): boolean {
  return provider.enabled && provider.capabilities.includes(PURPOSE_NEEDS[purpose])
}
