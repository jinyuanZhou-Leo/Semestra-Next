import { Info, Languages, Palette, Settings } from 'lucide-react'
import { defineModule, preloadable } from '@/app/extensions'
import { m } from '@/paraglide/messages'

/** M11 设置与偏好: the settings framework itself lives in `app/settings`; this is its content. */
export default defineModule({
  id: 'settings',
  kind: 'core',
  name: m.settings_name,
  description: m.settings_description,
  icon: Settings,
  settingsSections: [
    {
      id: 'appearance',
      level: 'account',
      group: 'preferences',
      title: m.settings_appearance_title,
      description: m.settings_appearance_description,
      icon: Palette,
      order: 10,
      component: preloadable(() => import('./AppearanceSettings')),
    },
    {
      id: 'language-time',
      level: 'account',
      group: 'preferences',
      title: m.settings_language_time_title,
      description: m.settings_language_time_description,
      icon: Languages,
      order: 20,
      component: preloadable(() => import('./LanguageSettings')),
    },
    {
      id: 'about',
      level: 'account',
      group: 'about',
      title: m.settings_about_title,
      icon: Info,
      order: 10,
      component: preloadable(() => import('./AboutSettings')),
    },
  ],
  realtimeInvalidations: {
    'settings.preferences.updated': ['settingsPreferenceGet'],
    'settings.values.updated': ['settingsValueGet'],
  },
})
