import type { Provider } from '@semestra/api-client'
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
    needsKey: true,
    needsBaseUrl: false,
    chooseCapabilities: false,
    defaultCapabilities: [],
  },
  openai: {
    name: m.ai_kind_openai,
    hint: m.ai_kind_openai_hint,
    needsKey: true,
    needsBaseUrl: false,
    chooseCapabilities: false,
    defaultCapabilities: [],
  },
  gemini: {
    name: m.ai_kind_gemini,
    hint: m.ai_kind_gemini_hint,
    needsKey: true,
    needsBaseUrl: false,
    chooseCapabilities: false,
    defaultCapabilities: [],
  },
  openai_compatible: {
    name: m.ai_kind_openai_compatible,
    hint: m.ai_kind_openai_compatible_hint,
    needsKey: false,
    needsBaseUrl: true,
    chooseCapabilities: true,
    defaultCapabilities: ['chat', 'tools'],
    baseUrlPlaceholder: 'https://api.deepseek.com/v1',
  },
  openai_responses: {
    name: m.ai_kind_openai_responses,
    hint: m.ai_kind_openai_responses_hint,
    needsKey: false,
    needsBaseUrl: true,
    chooseCapabilities: true,
    defaultCapabilities: ['chat', 'tools', 'structured'],
    baseUrlPlaceholder: 'https://api.openai.com/v1',
  },
  anthropic_compatible: {
    name: m.ai_kind_anthropic_compatible,
    hint: m.ai_kind_anthropic_compatible_hint,
    needsKey: false,
    needsBaseUrl: true,
    chooseCapabilities: true,
    defaultCapabilities: ['chat', 'tools'],
    baseUrlPlaceholder: 'https://api.deepseek.com/anthropic',
  },
  ollama: {
    name: m.ai_kind_ollama,
    hint: m.ai_kind_ollama_hint,
    needsKey: false,
    needsBaseUrl: true,
    chooseCapabilities: true,
    defaultCapabilities: ['chat', 'tools', 'structured', 'embedding'],
    baseUrlPlaceholder: 'http://localhost:11434',
  },
}

/** Short badge words for the errors that say something about the provider itself (M06 §8). */
export const PROVIDER_ERROR_LABEL: Record<string, Message> = {
  'ai.invalid_key': m.ai_provider_status_invalid_key,
  'ai.out_of_credit': m.ai_provider_status_out_of_credit,
  'ai.provider_unreachable': m.ai_provider_status_unreachable,
}

export const PURPOSE_TITLES: Record<AiPurpose, Message> = {
  chat: m.ai_purpose_chat,
  extraction: m.ai_purpose_extraction,
  vision: m.ai_purpose_vision,
  ocr: m.ai_purpose_ocr,
  embedding: m.ai_purpose_embedding,
  title: m.ai_purpose_title,
}

export const PURPOSE_HINTS: Record<AiPurpose, Message> = {
  chat: m.ai_purpose_chat_hint,
  extraction: m.ai_purpose_extraction_hint,
  vision: m.ai_purpose_vision_hint,
  ocr: m.ai_purpose_ocr_hint,
  embedding: m.ai_purpose_embedding_hint,
  title: m.ai_purpose_title_hint,
}

/** What sets the self-hosted server's PaddleOCR models apart (`local_ocr.MODELS`). */
export const LOCAL_OCR_HINTS: Record<string, Message> = {
  'PP-OCRv6_tiny': m.ai_local_ocr_v6_tiny,
  'PP-OCRv6_small': m.ai_local_ocr_v6_small,
  'PP-OCRv6_medium': m.ai_local_ocr_v6_medium,
  'PP-OCRv5_mobile': m.ai_local_ocr_v5_mobile,
  'PP-OCRv5_server': m.ai_local_ocr_v5_server,
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
  ocr: 'vision',
  embedding: 'embedding',
  title: 'chat',
}

export function canServe(provider: Provider, purpose: AiPurpose): boolean {
  return provider.enabled && provider.capabilities.includes(PURPOSE_NEEDS[purpose])
}
