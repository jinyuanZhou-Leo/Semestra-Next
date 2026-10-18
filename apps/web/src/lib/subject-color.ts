/** A palette slot (`subject-1` … `subject-12`) or a user-chosen `#rrggbb` color (M00 §4.6). */
export type SubjectColorRef = `subject-${number}` | `#${string}`

export const SUBJECT_PALETTE_SIZE = 12

const HEX = /^#[0-9a-f]{6}$/i

/**
 * CSS color for a course or subject. Palette slots are theme tokens with light and dark variants;
 * custom hex colors are used as given. Unknown values fall back to the first slot.
 */
export function subjectColor(ref: string | null | undefined): string {
  const slot = /^subject-(\d+)$/.exec(ref ?? '')
  if (slot) {
    const n = Number(slot[1])
    if (n >= 1 && n <= SUBJECT_PALETTE_SIZE) return `var(--subject-${n})`
  }
  if (ref && HEX.test(ref)) return ref
  return 'var(--subject-1)'
}
