import type { Provider } from '@semestra/api-client'
import anthropicLogo from '@lobehub/icons-static-svg/icons/anthropic.svg?url'
import deepseekLogo from '@lobehub/icons-static-svg/icons/deepseek.svg?url'
import geminiLogo from '@lobehub/icons-static-svg/icons/gemini.svg?url'
import kimiLogo from '@lobehub/icons-static-svg/icons/kimi.svg?url'
import ollamaLogo from '@lobehub/icons-static-svg/icons/ollama.svg?url'
import openaiLogo from '@lobehub/icons-static-svg/icons/openai.svg?url'
import openrouterLogo from '@lobehub/icons-static-svg/icons/openrouter.svg?url'
import qwenLogo from '@lobehub/icons-static-svg/icons/qwen.svg?url'
import type { Message } from '@/app/extensions'
import { m } from '@/paraglide/messages'
import type { ProviderKind } from './labels'

/**
 * The services offered when adding a provider (M06 §7). A preset only fills in the form: the
 * provider is saved as its `kind` and `baseUrl`, so the server knows nothing about presets.
 * `kind: null` is "another compatible endpoint", where the user picks the protocol.
 */
export type ProviderPreset = {
  id: string
  name: Message
  /** One line under the name in the picker. */
  note: Message
  logo: string | null
  kind: ProviderKind | null
  baseUrl?: string
  /** Assigned to the tasks nothing serves yet (endpoints without recommended models). */
  model?: string
  /** Where the user creates a key. */
  keyUrl?: string
  /**
   * Services with separate mainland China and international sites: a key only works on the site
   * that issued it, so the user picks one and it sets `baseUrl` and `keyUrl`.
   */
  regions?: readonly PresetRegion[]
}

export type PresetRegion = { id: 'intl' | 'cn'; label: Message; baseUrl: string; keyUrl: string }

const brand =
  (name: string): Message =>
  () =>
    name

export const PRESETS: readonly ProviderPreset[] = [
  {
    id: 'anthropic',
    name: brand('Anthropic'),
    note: m.ai_preset_anthropic_note,
    logo: anthropicLogo,
    kind: 'anthropic',
    keyUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'openai',
    name: brand('OpenAI'),
    note: m.ai_preset_openai_note,
    logo: openaiLogo,
    kind: 'openai',
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'gemini',
    name: brand('Google Gemini'),
    note: m.ai_preset_gemini_note,
    logo: geminiLogo,
    kind: 'gemini',
    keyUrl: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'deepseek',
    name: brand('DeepSeek'),
    note: m.ai_preset_deepseek_note,
    logo: deepseekLogo,
    kind: 'anthropic_compatible',
    baseUrl: 'https://api.deepseek.com/anthropic',
    model: 'deepseek-flash',
    keyUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'kimi',
    name: brand('Kimi'),
    note: m.ai_preset_kimi_note,
    logo: kimiLogo,
    kind: 'openai_compatible',
    model: 'kimi-k2.6',
    regions: [
      {
        id: 'intl',
        label: m.ai_preset_region_intl,
        baseUrl: 'https://api.moonshot.ai/v1',
        keyUrl: 'https://platform.moonshot.ai/console/api-keys',
      },
      {
        id: 'cn',
        label: m.ai_preset_region_cn,
        baseUrl: 'https://api.moonshot.cn/v1',
        keyUrl: 'https://platform.moonshot.cn/console/api-keys',
      },
    ],
  },
  {
    id: 'qwen',
    name: m.ai_preset_qwen,
    note: m.ai_preset_qwen_note,
    logo: qwenLogo,
    kind: 'openai_compatible',
    model: 'qwen-plus',
    regions: [
      {
        id: 'intl',
        label: m.ai_preset_region_intl,
        baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
        keyUrl: 'https://modelstudio.console.alibabacloud.com/',
      },
      {
        id: 'cn',
        label: m.ai_preset_region_cn,
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        keyUrl: 'https://bailian.console.aliyun.com/model/settings/api-key',
      },
    ],
  },
  {
    id: 'openrouter',
    name: brand('OpenRouter'),
    note: m.ai_preset_openrouter_note,
    logo: openrouterLogo,
    kind: 'openai_compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    // OpenRouter's own router: picks a model per request, so the id never goes stale.
    model: 'openrouter/auto',
    keyUrl: 'https://openrouter.ai/keys',
  },
  {
    id: 'ollama',
    name: brand('Ollama'),
    note: m.ai_preset_ollama_note,
    logo: ollamaLogo,
    kind: 'ollama',
    baseUrl: 'http://localhost:11434',
  },
  {
    id: 'custom',
    name: m.ai_preset_custom,
    note: m.ai_preset_custom_note,
    logo: null,
    kind: null,
  },
]

const KIND_LOGOS: Partial<Record<ProviderKind, string>> = {
  anthropic: anthropicLogo,
  openai: openaiLogo,
  gemini: geminiLogo,
  ollama: ollamaLogo,
}

/** The host of a URL ("api.deepseek.com"), or the text itself when it is not one. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** The addresses a preset can save: its own, or one per region. */
function presetUrls(preset: ProviderPreset): string[] {
  return [preset.baseUrl, ...(preset.regions ?? []).map((r) => r.baseUrl)].filter(
    (url): url is string => url !== undefined,
  )
}

/** The preset a saved compatible endpoint came from, recognised by its host. */
function presetFor(baseUrl: string | null): ProviderPreset | undefined {
  if (!baseUrl) return undefined
  const host = hostOf(baseUrl)
  return PRESETS.find(
    (p) => p.kind !== 'ollama' && presetUrls(p).some((url) => hostOf(url) === host),
  )
}

/** The region a new connection starts on: mainland China for the Chinese interface. */
export function defaultRegion(preset: ProviderPreset, locale: string): PresetRegion | undefined {
  const regions = preset.regions ?? []
  return regions.find((r) => r.id === (locale === 'zh-CN' ? 'cn' : 'intl')) ?? regions[0]
}

/** The brand mark of a saved provider: its kind's, or the service its endpoint points at. */
export function providerLogo(provider: Pick<Provider, 'kind' | 'base_url'>): string | null {
  return KIND_LOGOS[provider.kind] ?? presetFor(provider.base_url)?.logo ?? null
}
