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
  'grades',
  'account',
  'security',
  'preferences',
  'ai-providers',
  'ai-models',
  'ai-usage',
  'ai-permissions',
  'ai-memory',
  'ai-mcp',
  'calendar',
  'features',
  'integrations',
  'plugins',
  'data',
  'about',
]

export const GROUP_TITLES: Record<SettingsGroup, Message> = {
  general: m.settings_group_general,
  grades: m.settings_group_grades,
  account: m.settings_group_account,
  security: m.settings_group_security,
  preferences: m.settings_group_preferences,
  'ai-providers': m.settings_group_ai_providers,
  'ai-models': m.settings_group_ai_models,
  'ai-usage': m.settings_group_ai_usage,
  'ai-permissions': m.settings_group_ai_permissions,
  'ai-memory': m.settings_group_ai_memory,
  'ai-mcp': m.settings_group_ai_mcp,
  calendar: m.settings_group_calendar,
  features: m.settings_group_features,
  integrations: m.settings_group_integrations,
  plugins: m.settings_group_plugins,
  data: m.settings_group_data,
  about: m.settings_group_about,
}

/**
 * Groups that were split or renamed, so old `?settings=account/<group>` links still open the page
 * that took their place (a `#section` in the link wins over this: see `SettingsDialog`).
 */
export const GROUP_ALIASES: Readonly<Record<string, SettingsGroup>> = {
  ai: 'ai-providers',
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

/** Headings that cluster the account settings groups in the navigation. */
export type NavCluster = 'personal' | 'ai' | 'features' | 'system'

export const CLUSTER_TITLES: Record<NavCluster, Message> = {
  personal: m.settings_cluster_personal,
  ai: m.settings_cluster_ai,
  features: m.settings_cluster_features,
  system: m.settings_cluster_system,
}

const ACCOUNT_CLUSTERS: Partial<Record<SettingsGroup, NavCluster>> = {
  account: 'personal',
  security: 'personal',
  preferences: 'personal',
  'ai-providers': 'ai',
  'ai-models': 'ai',
  'ai-usage': 'ai',
  'ai-permissions': 'ai',
  'ai-memory': 'ai',
  'ai-mcp': 'ai',
  calendar: 'features',
  features: 'features',
  integrations: 'features',
  plugins: 'features',
  data: 'system',
  about: 'system',
}

/**
 * The groups of a level as runs under a heading. Only the account settings are long enough to
 * need headings; scoped levels come back as one run without one.
 */
export function clusterNavigation(
  groups: readonly NavGroup[],
  level: SettingsLevel,
): { cluster?: NavCluster; groups: NavGroup[] }[] {
  if (level !== 'account') return groups.length ? [{ groups: [...groups] }] : []
  const runs: { cluster?: NavCluster; groups: NavGroup[] }[] = []
  for (const group of groups) {
    const cluster = ACCOUNT_CLUSTERS[group.id]
    const last = runs.at(-1)
    if (last && last.cluster === cluster) last.groups.push(group)
    else runs.push({ cluster, groups: [group] })
  }
  return runs
}
