import * as messages from '@/paraglide/messages'
import { m } from '@/paraglide/messages'
import { getLocale } from '@/paraglide/runtime'

const byKey = messages as unknown as Record<string, (() => string) | undefined>

/** Pydantic AI's built-in tools and the loop's own (not capabilities). */
const META_TITLES: Record<string, () => string> = {
  search_tools: m.assistant_step_search_tools,
  load_capability: m.assistant_step_load_capability,
  read_tool_result: m.assistant_step_read_tool_result,
}

/** The localized name of a capability (`capability_<name>_title`, M12 §7), else the name. */
export function capabilityTitle(name: string): string {
  const meta = META_TITLES[name]
  if (meta) return meta()
  return byKey[`capability_${name.replaceAll('.', '_').replaceAll('-', '_')}_title`]?.() ?? name
}

/** A skill's title in the UI language (skill files carry `en` and `zh-CN`). */
export function skillTitle(
  title: Record<string, string> | null | undefined,
  fallback = '',
): string {
  if (!title) return fallback
  return title[getLocale()] ?? title.en ?? Object.values(title)[0] ?? fallback
}
