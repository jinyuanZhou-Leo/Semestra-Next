import { settingsMessages as messages } from '@/lib/message-groups/settings.gen'

// Message keys are identifiers: dots and dashes (`plugin.pomodoro`, `zh-CN`) become underscores.
const part = (value: unknown) => String(value).replaceAll(/[.-]/g, '_')

const lookup = (key: string) => messages[key]?.()

/** `settings_<namespace>_<field>_label` (falls back to the field name so a gap is visible, not fatal). */
export function fieldLabel(namespace: string, field: string): string {
  return lookup(`settings_${part(namespace)}_${field}_label`) ?? field
}

export function fieldDescription(namespace: string, field: string): string | undefined {
  return lookup(`settings_${part(namespace)}_${field}_description`)
}

/** `settings_<namespace>_<field>_option_<value>` for select and segmented choices. */
export function optionLabel(namespace: string, field: string, value: unknown): string {
  return lookup(`settings_${part(namespace)}_${field}_option_${part(value)}`) ?? String(value)
}

/** `settings_<namespace>_<field>_option_<value>_description`: one line on what a choice does. */
export function optionHint(namespace: string, field: string, value: unknown): string | undefined {
  return lookup(`settings_${part(namespace)}_${field}_option_${part(value)}_description`)
}
