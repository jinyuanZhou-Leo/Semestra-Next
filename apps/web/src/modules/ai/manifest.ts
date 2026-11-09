import type { AiProviderListResponse, AiStatusGetResponse } from '@semestra/api-client'
import { aiProviderListOptions } from '@semestra/api-client/react-query'
import { BarChart3, Boxes, HardDriveDownload, KeyRound, Sparkles } from 'lucide-react'
import { defineModule, preloadable } from '@/app/extensions'
import { ONBOARDING_STEPS, type OnboardingStep } from '@/modules/academics/types'
import { m } from '@/paraglide/messages'
import { aiStatusOptions } from '@/hooks/use-ai-status'
import { AI_QUERIES } from './queries'

const EVENTS = [
  'ai.provider.created',
  'ai.provider.updated',
  'ai.provider.deleted',
  'ai.assignment.updated',
  'ai.local_ocr.downloaded',
  'ai.local_embedding.downloaded',
  'ai.local_model.deleted',
] as const

const settings = () => import('./settings/sections')

const onboardingSteps: readonly OnboardingStep[] = [
  {
    id: 'ai.connect',
    order: 100,
    icon: Sparkles,
    title: m.ai_onboarding_title,
    description: m.ai_onboarding_body,
    component: preloadable(() => import('./onboarding/ConnectAiStep')),
    summary: preloadable(() => import('./onboarding/AiSummary')),
    status: {
      queries: () => [aiStatusOptions(), aiProviderListOptions()],
      // Left out where the server already serves AI without a provider of the user's.
      read: ([status, providers]) => {
        const purposes = (status as AiStatusGetResponse).items
        return {
          offered:
            (providers as AiProviderListResponse).items.length > 0 ||
            !purposes.some((p) => p.available),
          provides: purposes.filter((p) => p.available).map((p) => `ai.${p.purpose}`),
        }
      },
    },
  },
]

/**
 * M06 AI 接入层: the user's providers (BYOK), the model for each purpose and usage. Other
 * modules gate their AI entry points with `<AiRequired>` and `useAiStatus` (global, M06 §7).
 */
export default defineModule({
  id: 'ai',
  kind: 'core',
  name: m.ai_name,
  description: m.ai_description,
  icon: Sparkles,
  settingsSections: [
    {
      id: 'local-models',
      level: 'account',
      group: 'data',
      title: m.ai_local_models_title,
      icon: HardDriveDownload,
      // After storage: both say what takes space.
      order: 7,
      component: preloadable(() => settings().then((s) => ({ default: s.LocalModelsSection }))),
    },
    {
      id: 'ai-providers',
      level: 'account',
      group: 'ai-providers',
      title: m.ai_settings_providers,
      description: m.ai_settings_providers_description,
      icon: KeyRound,
      order: 10,
      component: preloadable(() => settings().then((s) => ({ default: s.ProvidersSection }))),
    },
    {
      id: 'ai-models',
      level: 'account',
      group: 'ai-models',
      title: m.ai_settings_models,
      description: m.ai_settings_models_description,
      icon: Boxes,
      order: 11,
      component: preloadable(() => settings().then((s) => ({ default: s.ModelsSection }))),
    },
    {
      id: 'ai-usage',
      level: 'account',
      group: 'ai-usage',
      title: m.ai_settings_usage,
      description: m.ai_settings_usage_description,
      icon: BarChart3,
      order: 12,
      component: preloadable(() => settings().then((s) => ({ default: s.UsageSection }))),
    },
  ],
  extensions: { [ONBOARDING_STEPS]: onboardingSteps },
  jobKinds: [
    { kind: 'ai.local_ocr.download', title: m.ai_job_local_ocr_download },
    { kind: 'ai.local_embedding.download', title: m.ai_job_local_embedding_download },
  ],
  uiPrefPrefixes: ['ai.'],
  realtimeInvalidations: Object.fromEntries(EVENTS.map((event) => [event, AI_QUERIES])),
})
