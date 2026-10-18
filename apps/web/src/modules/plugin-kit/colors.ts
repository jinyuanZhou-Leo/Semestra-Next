/**
 * Color choices of the plugins' cards (M14 §0: tokens only). A choice is a token name from the
 * theme; `colorVar` turns it into a CSS color that follows light/dark mode and the accent.
 */

export const COLOR_TOKENS = [
  'primary',
  'success',
  'subject-1',
  'subject-2',
  'subject-7',
  'subject-9',
  'subject-10',
  'subject-11',
] as const

export type ColorToken = (typeof COLOR_TOKENS)[number]

export function colorVar(token: string): string {
  return (COLOR_TOKENS as readonly string[]).includes(token) ? `var(--${token})` : 'var(--primary)'
}

/** A soft background of the same color that stays readable in both themes. */
export function colorTint(token: string, percent = 14): string {
  return `color-mix(in oklab, ${colorVar(token)} ${percent}%, var(--card))`
}
