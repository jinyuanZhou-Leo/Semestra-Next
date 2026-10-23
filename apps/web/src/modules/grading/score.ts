import type { AssessmentUpdateInputBody } from '@semestra/api-client'

/** What the user typed in a score cell. */
export type ParsedScore =
  | { kind: 'clear' }
  | { kind: 'percentage'; value: number }
  | { kind: 'points'; earned: number; possible: number }
  | { kind: 'invalid' }

const MAX_PERCENTAGE = 1000
const MAX_POINTS = 100_000

function parseNumber(text: string): number | null {
  const normalized = text.trim().replace(',', '.')
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(normalized)) return null
  return Number(normalized)
}

/**
 * A non-negative number as typed in any grading field: digits with a decimal point or comma,
 * an optional trailing `%`, nothing else (`Number()` would also take `0x10` or `1e2`).
 * Null when it is not one.
 */
export function parseDecimal(input: string): number | null {
  return parseNumber(input.trim().replace(/%$/, ''))
}

/**
 * `82` / `82%` is a percentage, `18/20` is points earned of points possible, empty clears the
 * score (M03 §5.1). Full-width slashes and decimal commas are accepted.
 */
export function parseScore(input: string): ParsedScore {
  const text = input.trim().replace('／', '/')
  if (text === '') return { kind: 'clear' }
  if (text.includes('/')) {
    const [left, right, ...rest] = text.split('/')
    const earned = parseNumber(left ?? '')
    const possible = parseNumber(right ?? '')
    if (rest.length > 0 || earned === null || possible === null) return { kind: 'invalid' }
    if (possible <= 0 || possible > MAX_POINTS || earned > MAX_POINTS) return { kind: 'invalid' }
    return { kind: 'points', earned, possible }
  }
  const value = parseNumber(text.replace(/%$/, ''))
  if (value === null || value > MAX_PERCENTAGE) return { kind: 'invalid' }
  return { kind: 'percentage', value }
}

/** The assessment fields to send for a parsed score; null when the text was not a score. */
export function scorePatch(parsed: ParsedScore): AssessmentUpdateInputBody | null {
  switch (parsed.kind) {
    case 'clear':
      return { score_percentage: null }
    case 'percentage':
      return { score_percentage: parsed.value }
    case 'points':
      return { points_earned: parsed.earned, points_possible: parsed.possible }
    case 'invalid':
      return null
  }
}

/** A stored score as the text to edit: `18/20` for a points score, else the percentage. */
export function scoreText(a: {
  score_percentage: number | null
  points_earned: number | null
  points_possible: number | null
}): string {
  if (a.points_earned !== null && a.points_possible !== null) {
    return `${trim(a.points_earned)}/${trim(a.points_possible)}`
  }
  return a.score_percentage === null ? '' : trim(a.score_percentage)
}

function trim(value: number): string {
  return String(Math.round(value * 100) / 100)
}
