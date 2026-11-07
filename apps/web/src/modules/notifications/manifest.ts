import { BellRing, Moon, Smartphone, Sparkles } from 'lucide-react'
import { defineModule, preloadable } from '@/app/extensions'
import { ONBOARDING_STEPS, type OnboardingStep } from '@/modules/academics/types'
import { m } from '@/paraglide/messages'
import {
  ACTIVITY_FIELDS,
  NAMESPACE,
  QUIET_FIELDS,
  REMINDER_FIELDS,
  hiddenExcept,
} from './categories'
import { NotificationsSync } from './NotificationsSync'
import { canOffer } from './push'

const onboardingSteps: readonly OnboardingStep[] = [
  {
    id: 'notifications.enable',
    // After connecting AI.
    order: 200,
    title: m.notifications_onboarding_title,
    component: preloadable(() => import('./onboarding/NotificationsStep')),
    available: canOffer,
  },
]

const form = (fields: readonly string[]) => ({ order: fields, hidden: hiddenExcept(fields) })

/**
 * M18 通知: system notifications through Web Push. This device's subscription, what to be told
 * about (namespace `notifications`) and the onboarding step; the texts come from the server.
 */
export default defineModule({
  id: 'notifications',
  kind: 'core',
  name: m.notifications_name,
  description: m.notifications_description,
  icon: BellRing,
  settingsSections: [
    {
      id: 'notifications-device',
      level: 'account',
      group: 'notifications',
      title: m.notifications_section_device,
      icon: Smartphone,
      order: 10,
      component: preloadable(() => import('./settings/DeviceSection')),
    },
    {
      id: 'notifications-reminders',
      level: 'account',
      group: 'notifications',
      title: m.notifications_section_reminders,
      description: m.notifications_section_reminders_description,
      icon: BellRing,
      order: 20,
      namespace: NAMESPACE,
      fields: form(REMINDER_FIELDS),
    },
    {
      id: 'notifications-activity',
      level: 'account',
      group: 'notifications',
      title: m.notifications_section_activity,
      description: m.notifications_section_activity_description,
      icon: Sparkles,
      order: 30,
      namespace: NAMESPACE,
      fields: form(ACTIVITY_FIELDS),
    },
    {
      id: 'notifications-quiet',
      level: 'account',
      group: 'notifications',
      title: m.notifications_section_quiet,
      description: m.notifications_section_quiet_description,
      icon: Moon,
      order: 40,
      namespace: NAMESPACE,
      fields: form(QUIET_FIELDS),
    },
  ],
  extensions: { [ONBOARDING_STEPS]: onboardingSteps },
  overlays: [NotificationsSync],
})
