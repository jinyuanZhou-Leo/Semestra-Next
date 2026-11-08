import type { Meeting, Section } from '@semestra/api-client'
import { m } from '@/paraglide/messages'

/** One weekly time with its section: the section holds its type, code and weeks. */
export type SectionTime = { section: Section; meeting: Meeting }

export const sectionTimes = (sections: readonly Section[]): SectionTime[] =>
  sections.flatMap((section) => section.meetings.map((meeting) => ({ section, meeting })))

/** Whether a section runs every week of the term, skipping breaks: the section dialog's default. */
export const wholeTerm = (s: Section) =>
  s.recurrence === 'weekly' && s.start_week === 1 && s.end_week == null && s.skip_breaks

/** The weeks a section runs, e.g. "Biweekly (week 2) · Weeks 1–12". */
export function weeksText(s: Section): string {
  if (wholeTerm(s)) return m.schedule_weeks_whole_term()
  const range = s.end_week
    ? m.schedule_weeks_range({ start: s.start_week, end: s.end_week })
    : m.schedule_weeks_from({ start: s.start_week })
  return s.recurrence === 'biweekly'
    ? `${m.schedule_recurrence_biweekly()} (${m.schedule_week_number({ number: s.anchor_week })}) · ${range}`
    : range
}

/**
 * The code a new section of `type` most likely has: the next number after the type's sections
 * ("LEC0101", "LEC0102" → "LEC0103"), keeping their prefix and width; "LEC0101" for the first.
 */
export function nextSectionCode(type: string, sections: readonly Section[]): string {
  let best: { prefix: string; digits: string; n: number } | undefined
  for (const s of sections) {
    if (s.type_code !== type) continue
    const match = /^(.*?)(\d+)$/.exec(s.section_code)
    if (!match) continue
    const n = Number(match[2])
    if (!best || n > best.n) best = { prefix: match[1]!, digits: match[2]!, n }
  }
  if (!best) return `${type}0101`
  return `${best.prefix}${String(best.n + 1).padStart(best.digits.length, '0')}`
}
