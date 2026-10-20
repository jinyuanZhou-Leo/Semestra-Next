import * as messages from '@/paraglide/messages'
import { m } from '@/paraglide/messages'
import { getLocale } from '@/paraglide/runtime'
import type { Step } from './transcript'

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

const ID_ARG = /(^id$|^fields$|_ids?$)/

/**
 * Arguments as people read them: without ids (the step names them) and without objects that
 * only held ids. Undefined when nothing is left.
 */
export function plainValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map(plainValue).filter((v) => v !== undefined)
    return items.length > 0 || value.length === 0 ? items : undefined
  }
  if (value !== null && typeof value === 'object') {
    const kept = Object.entries(value)
      .filter(([key]) => !ID_ARG.test(key))
      .map(([key, inner]) => [key, plainValue(inner)] as const)
      .filter(([, inner]) => inner !== undefined)
    if (kept.every(([key]) => key === 'kind')) return undefined
    return Object.fromEntries(kept)
  }
  return value
}

export function plainArgs(args: Record<string, unknown>): [string, unknown][] {
  return Object.entries(args)
    .filter(([key]) => !ID_ARG.test(key))
    .map(([key, value]) => [key, plainValue(value)] as [string, unknown])
    .filter(([, value]) => value !== undefined)
}

/** A field's name for people: a shared translation when there is one, else its words. */
export function fieldLabel(field: string, schemaTitle?: string): string {
  return byKey[`assistant_field_${field}`]?.() ?? schemaTitle ?? field.replaceAll('_', ' ')
}

/** An error or issue code (`import.outside_term`) in words, else the value itself. */
function codeText(value: string): string {
  if (value === 'accept') return m.assistant_value_accept()
  if (value === 'reject') return m.assistant_value_reject()
  if (!/^[a-z]+(\.[a-z_]+)+$/.test(value)) return value
  return byKey[`error_${value.replaceAll('.', '_')}`]?.() ?? value
}

function dateRange(record: Record<string, unknown>): string | null {
  const start = record.start_date ?? record.first_date
  const end = record.end_date ?? record.last_date
  if (typeof start !== 'string') return null
  return typeof end === 'string' && end !== start ? `${start} – ${end}` : start
}

/** A value on a card or step: lists as lists, named things by their name, codes in words. */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? m.assistant_value_yes() : m.assistant_value_no()
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return codeText(value)
  if (Array.isArray(value)) {
    const parts = value.map(formatValue)
    return new Intl.ListFormat(getLocale(), { type: 'unit' }).format(parts)
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const name = [record.name, record.title, record.code].find((v) => typeof v === 'string')
    const range = dateRange(record)
    if (typeof name === 'string') return range ? `${name} (${range})` : name
    if (range) return range
    return Object.entries(record)
      .map(([key, inner]) => `${fieldLabel(key)}: ${formatValue(inner)}`)
      .join('; ')
  }
  return String(value)
}

/** What a step's line says after its title: names, then short facts, then what needs a look. */
export type StepLine = { target: string; details: string[]; issues: number }

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function stepLine(step: Step, skillTitles: ReadonlyMap<string, string>): StepLine {
  const shown = step.display ?? {}
  const args = step.args
  let target = (shown.target ?? []).join(' · ')
  if (step.name === 'load_capability' && typeof args.id === 'string') {
    target = skillTitles.get(args.id) ?? ''
  }
  if (!target) {
    const preview = step.proposal?.preview as { target?: unknown } | null | undefined
    if (typeof preview?.target === 'string') target = preview.target
  }
  const details: string[] = []
  const from = num(args.page_from)
  const to = num(args.page_to)
  if (from !== null) {
    details.push(
      to !== null && to !== from
        ? m.assistant_step_pages({ from, to })
        : m.assistant_step_page({ page: from }),
    )
  }
  const accepted = Object.entries(shown.accepted ?? {}).filter(([, n]) => n > 0)
  for (const [type, count] of accepted) {
    const label = byKey[`imports_type_${type}`]?.() ?? type
    details.push(`${label} ${count}`)
  }
  if (shown.changed !== undefined) {
    details.push(
      args.decision === 'accept'
        ? m.assistant_step_accepted_items({ count: shown.changed })
        : m.assistant_step_rejected_items({ count: shown.changed }),
    )
  }
  if (shown.created) details.push(m.assistant_step_created({ count: shown.created }))
  if (shown.updated) details.push(m.assistant_step_updated({ count: shown.updated }))
  if (shown.failed) details.push(m.assistant_step_failed_items({ count: shown.failed }))
  const counted =
    accepted.length === 0 && shown.changed === undefined && shown.created === undefined
  if (counted && shown.count !== undefined && from === null) {
    details.push(
      shown.count === 0 ? m.assistant_step_none() : m.assistant_step_count({ count: shown.count }),
    )
  }
  return { target, details, issues: shown.issues ?? 0 }
}
