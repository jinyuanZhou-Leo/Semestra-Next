import { settingsMessages as messages } from '@/lib/message-groups/settings.gen'

// Message keys are identifiers: dots and dashes (`plugin.pomodoro`, `zh-CN`) become underscores.
const part = (value: unknown) => String(value).replaceAll(/[.-]/g, '_')

/** Values a namespace's texts take, such as the platform a setting is about (`{provider}`). */
export type TextParams = Readonly<Record<string, string>>

const lookup = (key: string, params?: TextParams) => messages[key]?.(params)

/** `settings_<namespace>_<field>_label` (falls back to the field name so a gap is visible, not fatal). */
export function fieldLabel(namespace: string, field: string): string {
  return lookup(`settings_${part(namespace)}_${field}_label`) ?? field
}

export function fieldDescription(
  namespace: string,
  field: string,
  params?: TextParams,
): string | undefined {
  return lookup(`settings_${part(namespace)}_${field}_description`, params)
}

/** `settings_<namespace>_<field>_option_<value>` for select and segmented choices. */
export function optionLabel(
  namespace: string,
  field: string,
  value: unknown,
  params?: TextParams,
): string {
  return (
    lookup(`settings_${part(namespace)}_${field}_option_${part(value)}`, params) ?? String(value)
  )
}

/** `settings_<namespace>_<field>_option_<value>_description`: one line on what a choice does. */
export function optionHint(
  namespace: string,
  field: string,
  value: unknown,
  params?: TextParams,
): string | undefined {
  return lookup(`settings_${part(namespace)}_${field}_option_${part(value)}_description`, params)
}
