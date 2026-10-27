import type { BreakIn, Course, Term } from '@semestra/api-client'
import { m } from '@/paraglide/messages'
import type { CourseDraft } from '../types'

/** One course row of the wizard's table; imported rows keep their draft for the source module. */
export type DraftRow = {
  key: string
  code: string
  title: string
  /** Empty: the Program's default credits. */
  credits: string
  yearLong: boolean
  sourceId?: string
  draft?: CourseDraft
}

export type WizardDraft = {
  step: number
  name: string
  /** Once the user typed a name, dates stop suggesting one. */
  nameEdited: boolean
  start: string
  end: string
  breaks: BreakIn[]
  countBreakWeeks: boolean
  rows: DraftRow[]
  /** Year-long courses the user chose not to continue (all others are, by default). */
  skipContinue: string[]
}

export const EMPTY_DRAFT: WizardDraft = {
  step: 0,
  name: '',
  nameEdited: false,
  start: '',
  end: '',
  breaks: [],
  countBreakWeeks: false,
  rows: [],
  skipContinue: [],
}

const key = (programId: string) => `semestra.termWizard.${programId}`

/** The wizard survives a reload of the tab (sessionStorage, per Program; M02 §5.6). */
export function loadDraft(programId: string): WizardDraft {
  try {
    const raw = sessionStorage.getItem(key(programId))
    if (raw) return { ...EMPTY_DRAFT, ...(JSON.parse(raw) as Partial<WizardDraft>) }
  } catch {
    // Storage blocked or a broken value: start over.
  }
  return EMPTY_DRAFT
}

export function saveDraft(programId: string, draft: WizardDraft) {
  try {
    sessionStorage.setItem(key(programId), JSON.stringify(draft))
  } catch {
    // Storage blocked: the draft only lives in memory.
  }
}

export function clearDraft(programId: string) {
  try {
    sessionStorage.removeItem(key(programId))
  } catch {
    // Nothing stored.
  }
}

/** Whether leaving would lose anything worth asking about. */
export function isDirty(draft: WizardDraft): boolean {
  return Boolean(draft.name || draft.start || draft.end || draft.breaks.length || draft.rows.length)
}

/** "Fall 2026" / "2026 秋季" from the start date (M02 §5.6). */
export function suggestTermName(start: string): string {
  const match = /^(\d{4})-(\d{2})/.exec(start)
  if (!match) return ''
  const year = Number(match[1])
  const month = Number(match[2])
  if (month === 1) return m.academics_term_name_winter({ year })
  if (month <= 4) return m.academics_term_name_spring({ year })
  if (month <= 7) return m.academics_term_name_summer({ year })
  return m.academics_term_name_fall({ year })
}

/**
 * Year-long courses waiting for another term: they ended in the term right before the new one
 * and planned more terms than they have (M02 §2, §5.6).
 */
export function continuationCandidates(
  terms: readonly Term[],
  courses: readonly Course[],
  start: string,
): Course[] {
  const before = terms.filter((t) => !start || t.start_date < start)
  const previous = before.at(-1)
  if (!previous) return []
  return courses.filter((c) => c.end_term_id === previous.id && c.term_ids.length < c.planned_terms)
}

let counter = 0
export function newRowKey(): string {
  counter += 1
  return `row-${Date.now().toString(36)}-${counter}`
}

export function rowIsEmpty(row: DraftRow): boolean {
  return !row.code.trim() && !row.title.trim() && !row.credits.trim()
}

/** Blank is fine (the Program's default); otherwise a number from 0 to 100. */
export function creditsProblem(text: string): boolean {
  if (text.trim() === '') return false
  const n = Number(text)
  return !(n >= 0 && n <= 100)
}
