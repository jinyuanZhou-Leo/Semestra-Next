import { m } from '@/paraglide/messages'
import type { ItemType } from './types'

export type FieldKind = 'text' | 'number' | 'date' | 'time' | 'weekday' | 'recurrence' | 'switch'

/** One editable field of an item's draft (`ImportItem.data[key]`). */
export type FieldSpec = { key: string; label: () => string; kind: FieldKind; wide?: boolean }

/** The fields the review editor shows per item type, in order (M08 §2). */
export const FIELDS: Record<Exclude<ItemType, `${string}_patch`>, readonly FieldSpec[]> = {
  course: [
    { key: 'code', label: m.imports_field_code, kind: 'text' },
    { key: 'title', label: m.imports_field_title, kind: 'text', wide: true },
    { key: 'credits', label: m.imports_field_credits, kind: 'number' },
    { key: 'planned_terms', label: m.imports_field_year_long, kind: 'switch' },
  ],
  meeting: [
    { key: 'section_code', label: m.imports_field_section, kind: 'text' },
    { key: 'type_code', label: m.imports_field_type, kind: 'text' },
    { key: 'weekday', label: m.imports_field_weekday, kind: 'weekday' },
    { key: 'recurrence', label: m.imports_field_recurrence, kind: 'recurrence' },
    { key: 'start_time', label: m.imports_field_start_time, kind: 'time' },
    { key: 'end_time', label: m.imports_field_end_time, kind: 'time' },
    { key: 'first_date', label: m.imports_field_first_date, kind: 'date' },
    { key: 'last_date', label: m.imports_field_last_date, kind: 'date' },
    { key: 'location', label: m.imports_field_location, kind: 'text', wide: true },
  ],
  event: [
    { key: 'title', label: m.imports_field_title, kind: 'text', wide: true },
    { key: 'date', label: m.imports_field_date, kind: 'date' },
    { key: 'all_day', label: m.imports_field_all_day, kind: 'switch' },
    { key: 'start_time', label: m.imports_field_start_time, kind: 'time' },
    { key: 'end_time', label: m.imports_field_end_time, kind: 'time' },
    { key: 'location', label: m.imports_field_location, kind: 'text', wide: true },
  ],
  category: [
    { key: 'name', label: m.imports_field_name, kind: 'text', wide: true },
    { key: 'weight_total', label: m.imports_field_weight_total, kind: 'number' },
  ],
  assessment: [
    { key: 'title', label: m.imports_field_title, kind: 'text', wide: true },
    { key: 'weight', label: m.imports_field_weight, kind: 'number' },
    { key: 'due_date', label: m.imports_field_due_date, kind: 'date' },
    { key: 'due_time', label: m.imports_field_due_time, kind: 'time' },
  ],
  task: [
    { key: 'title', label: m.imports_field_title, kind: 'text', wide: true },
    { key: 'due_date', label: m.imports_field_due_date, kind: 'date' },
    { key: 'due_time', label: m.imports_field_due_time, kind: 'time' },
  ],
}

/** Labels of the fields a `*_patch` item can change (a course's, or an assessment's or task's). */
export const PATCH_LABELS: Record<string, () => string> = {
  due_date: m.imports_field_due_date,
  due_time: m.imports_field_due_time,
  weight: m.imports_field_weight,
  code: m.imports_field_code,
  title: m.imports_field_title,
  credits: m.imports_field_credits,
  instructors: m.imports_field_instructors,
  description: m.imports_field_description,
  website_url: m.imports_field_website,
  score: m.imports_field_score,
}
