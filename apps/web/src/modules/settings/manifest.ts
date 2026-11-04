import { DoorOpen, Info, Languages, Palette, Settings, SunMoon } from 'lucide-react'
import { type CommandContribution, defineModule, preloadable } from '@/app/extensions'
import { useSetTheme } from '@/app/preferences'
import { useTheme } from '@/app/theme'
import { THEME_OPTIONS } from '@/app/theme-options'
import { m } from '@/paraglide/messages'
import { WhatsNew } from './WhatsNew'

/** "Change theme →" in the command palette: the three choices of Settings → Appearance. */
const themeCommand: CommandContribution = {
  id: 'settings.theme',
  title: m.settings_command_theme,
  keywords: ['theme', 'dark', 'light', 'appearance', '主题', '深色', '浅色', '外观'],
  icon: SunMoon,
  useChildren: function useThemeChildren() {
    const { theme } = useTheme()
    const setTheme = useSetTheme()
    return THEME_OPTIONS.filter((option) => option.value !== theme).map((option) => ({
      id: option.value,
      title: option.label(),
      icon: option.icon,
      run: () => setTheme(option.value),
    }))
  },
}

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
      id: 'start',
      level: 'account',
      group: 'preferences',
      title: m.settings_start_title,
      description: m.settings_start_description,
      icon: DoorOpen,
      order: 30,
      component: preloadable(() => import('./StartSettings')),
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
  commands: [themeCommand],
  // "What's new" after an update (minor and major versions, once per account).
  overlays: [WhatsNew],
  uiPrefPrefixes: ['release.'],
  realtimeInvalidations: {
    'settings.preferences.updated': ['settingsPreferenceGet'],
    'settings.values.updated': ['settingsValueGet'],
  },
  // Only `useUpdatePreferences` changes preferences from a tab, and it refetches them after its
  // last change; the echo would refetch again, and could land between two quick changes.
  realtimeSkipOwn: ['settings.preferences.updated'],
})
