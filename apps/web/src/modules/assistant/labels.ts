import { assistantFieldMessages } from '@/lib/message-groups/assistant-fields.gen'
import { capabilityMessages } from '@/lib/message-groups/capabilities.gen'
import { errorMessages } from '@/lib/message-groups/errors.gen'
import { m } from '@/paraglide/messages'
import { getLocale } from '@/paraglide/runtime'
import { formatDate, formatDateTime, intl } from '@/lib/format'
import { TYPE_LABELS } from '@/modules/imports/labels'
import type { ItemType } from '@/modules/imports/types'
import type { Step } from './transcript'

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
  return (
    capabilityMessages[`capability_${name.replaceAll('.', '_').replaceAll('-', '_')}_title`]?.() ??
    name
  )
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
/** Paging arguments: pages are on the step's line, the rest is plumbing. */
const PAGING_ARG = /^(page_from|page_to|cursor|limit|offset)$/

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
    .filter(([key]) => !ID_ARG.test(key) && !PAGING_ARG.test(key))
    .map(([key, value]) => [key, plainValue(value)] as [string, unknown])
    .filter(([, value]) => value !== undefined)
}

/** A field's name for people: a shared translation when there is one, else its words. */
export function fieldLabel(field: string, schemaTitle?: string): string {
  return (
    assistantFieldMessages[`assistant_field_${field}`]?.() ??
    schemaTitle ??
    field.replaceAll('_', ' ')
  )
}

const DAY = /^\d{4}-\d{2}-\d{2}$/
const MOMENT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/

/** Words for the fixed values of a few fields (an import decision, a class's change). */
const VALUE_TEXT: Record<string, Record<string, () => string>> = {
  decision: {
    accept: m.assistant_value_accept,
    reject: m.assistant_value_reject,
    pending: m.assistant_value_pending,
  },
  exception: { cancelled: m.assistant_value_cancelled, moved: m.assistant_value_moved },
  as_kind: TYPE_LABELS,
  type: TYPE_LABELS,
}

/**
 * A string value in words: a fixed value of its field (an import decision), a date or a
 * moment in the UI's format, an error or issue code (`import.outside_term`), else the value
 * itself.
 */
function stringText(value: string, field?: string): string {
  const fixed = field ? VALUE_TEXT[field]?.[value] : undefined
  if (fixed) return fixed()
  if (DAY.test(value)) return formatDate(value)
  if (MOMENT.test(value) && !Number.isNaN(Date.parse(value))) return formatDateTime(value)
  if (!/^[a-z]+(\.[a-z_]+)+$/.test(value)) return value
  return errorMessages[`error_${value.replaceAll('.', '_')}`]?.() ?? value
}

function dateRange(record: Record<string, unknown>): string | null {
  const start = record.start_date ?? record.first_date
  const end = record.end_date ?? record.last_date
  if (typeof start !== 'string' || !DAY.test(start)) return null
  if (typeof end !== 'string' || !DAY.test(end) || end === start) return formatDate(start)
  // Calendar days: formatted in UTC so they keep their own day (as `formatDate` does).
  return intl(Intl.DateTimeFormat, { dateStyle: 'medium', timeZone: 'UTC' }).formatRange(
    new Date(start),
    new Date(end),
  )
}

/**
 * A value on a card or step: lists as lists, named things by their name, dates and codes in
 * words. `field` is the name of the field the value is in.
 */
export function formatValue(value: unknown, field?: string): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? m.assistant_value_yes() : m.assistant_value_no()
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return stringText(value, field)
  if (Array.isArray(value)) {
    const parts = value.map((each) => formatValue(each, field))
    // Chinese "unit" lists have no separator at all ("Lab 1Lab 2").
    if (getLocale().startsWith('zh')) return parts.join('、')
    return intl(Intl.ListFormat, { type: 'unit' }).format(parts)
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const name = [record.name, record.title, record.code].find((v) => typeof v === 'string')
    const range = dateRange(record)
    if (typeof name === 'string') return range ? `${name} (${range})` : name
    if (range) return range
    return Object.entries(record)
      .map(([key, inner]) => `${fieldLabel(key)}: ${formatValue(inner, key)}`)
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
    const label = type in TYPE_LABELS ? TYPE_LABELS[type as ItemType]() : type
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
