import { m } from '@/paraglide/messages'
import type {
  Message,
  SettingsGroup,
  SettingsLevel,
  SettingsSectionContribution,
} from '../extensions'

/** Navigation order of the groups (M11 §5.1, §5.2). */
export const GROUP_ORDER: readonly SettingsGroup[] = [
  'general',
  'account',
  'preferences',
  'features',
  'integrations',
  'plugins',
  'data',
  'about',
]

export const GROUP_TITLES: Record<SettingsGroup, Message> = {
  general: m.settings_group_general,
  account: m.settings_group_account,
  preferences: m.settings_group_preferences,
  features: m.settings_group_features,
  integrations: m.settings_group_integrations,
  plugins: m.settings_group_plugins,
  data: m.settings_group_data,
  about: m.settings_group_about,
}

export function groupOf(section: SettingsSectionContribution): SettingsGroup {
  return section.group ?? (section.level === 'account' ? 'features' : 'general')
}

export type NavGroup = {
  id: SettingsGroup
  sections: SettingsSectionContribution[]
}

/** Account-level plugin sections live on the plugin's own page (M10), not in this navigation. */
export function isNavigable(section: SettingsSectionContribution): boolean {
  return !(section.level === 'account' && section.pluginId)
}

/** The sections of a level, grouped and ordered; empty groups do not appear. */
export function buildNavigation(
  sections: readonly SettingsSectionContribution[],
  level: SettingsLevel,
): NavGroup[] {
  const groups = new Map<SettingsGroup, SettingsSectionContribution[]>()
  for (const section of sections) {
    if (section.level !== level || !isNavigable(section)) continue
    const id = groupOf(section)
    groups.set(id, [...(groups.get(id) ?? []), section])
  }
  return GROUP_ORDER.filter((id) => groups.has(id)).map((id) => ({
    id,
    sections: [...(groups.get(id) ?? [])].sort((a, b) => a.order - b.order),
  }))
}
