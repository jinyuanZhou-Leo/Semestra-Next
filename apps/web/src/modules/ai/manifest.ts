import { BarChart3, Boxes, KeyRound, Sparkles } from 'lucide-react'
import { lazy } from 'react'
import { defineModule } from '@/app/extensions'
import { ONBOARDING_STEPS, type OnboardingStep } from '@/modules/academics/types'
import { m } from '@/paraglide/messages'
import { AI_QUERIES } from './queries'

const EVENTS = [
  'ai.provider.created',
  'ai.provider.updated',
  'ai.provider.deleted',
  'ai.assignment.updated',
] as const

const settings = () => import('./settings/sections')

const onboardingSteps: readonly OnboardingStep[] = [
  {
    id: 'ai.connect',
    order: 100,
    title: m.ai_onboarding_title,
    component: lazy(() => import('./onboarding/ConnectAiStep')),
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
      id: 'ai-providers',
      level: 'account',
      group: 'features',
      title: m.ai_settings_providers,
      description: m.ai_settings_providers_description,
      icon: KeyRound,
      order: 10,
      component: lazy(() => settings().then((s) => ({ default: s.ProvidersSection }))),
    },
    {
      id: 'ai-models',
      level: 'account',
      group: 'features',
      title: m.ai_settings_models,
      description: m.ai_settings_models_description,
      icon: Boxes,
      order: 11,
      component: lazy(() => settings().then((s) => ({ default: s.ModelsSection }))),
    },
    {
      id: 'ai-usage',
      level: 'account',
      group: 'features',
      title: m.ai_settings_usage,
      description: m.ai_settings_usage_description,
      icon: BarChart3,
      order: 12,
      component: lazy(() => settings().then((s) => ({ default: s.UsageSection }))),
    },
  ],
  extensions: { [ONBOARDING_STEPS]: onboardingSteps },
  realtimeInvalidations: Object.fromEntries(EVENTS.map((event) => [event, AI_QUERIES])),
})
