import type { JSONContent } from '@tiptap/core'

/**
 * A skill picked with `/` (its name in `id`), or a course, term or course file picked with `@`:
 * the text holds it as `/<label>` or `@<label>`.
 */
export type MessageReference = {
  kind: 'skill' | 'course' | 'term' | 'file'
  id: string
  label: string
}

/** What a chip in the input stands for: `/compact` (first in the input), or a reference. */
export type Chip = { kind: 'command'; id: string; label: string } | MessageReference

/** What the input holds, as it is sent. */
export type PromptValue = {
  text: string
  /** `/compact` was chosen: the text says what to keep. */
  compact: boolean
  /** Skills, courses, terms and files, each once, in the order they are written. */
  references: MessageReference[]
}

export const EMPTY_PROMPT: PromptValue = { text: '', compact: false, references: [] }

/** The character a chip is written with: `/` for skills and `/compact`, `@` for the rest. */
export const chipChar = (kind: Chip['kind']) => (kind === 'skill' || kind === 'command' ? '/' : '@')

const KINDS = new Set<string>(['skill', 'command', 'course', 'term', 'file'])

/** The editor node of a chip (Tiptap's `mention`, its kind and id in `id`). */
export function chipNode(chip: Chip): JSONContent {
  return {
    type: 'mention',
    attrs: {
      id: `${chip.kind}:${chip.id}`,
      label: chip.label,
      mentionSuggestionChar: chipChar(chip.kind),
    },
  }
}

export function chipOf(attrs: Record<string, unknown> | undefined): Chip | null {
  const raw = typeof attrs?.id === 'string' ? attrs.id : ''
  const at = raw.indexOf(':')
  const kind = raw.slice(0, at)
  const label = typeof attrs?.label === 'string' ? attrs.label : ''
  return KINDS.has(kind) ? ({ kind, id: raw.slice(at + 1), label } as Chip) : null
}

/** Reads what the input holds: references become `/<label>` or `@<label>` in the text. */
export function readPrompt(doc: JSONContent): PromptValue {
  const value: PromptValue = { text: '', compact: false, references: [] }
  const lines: string[] = []
  for (const block of doc.content ?? []) {
    let line = ''
    for (const node of block.content ?? []) {
      if (node.type === 'text') line += node.text ?? ''
      else if (node.type === 'hardBreak') line += '\n'
      else if (node.type === 'mention') {
        const chip = chipOf(node.attrs)
        if (!chip) continue
        if (chip.kind === 'command') {
          value.compact = true
          continue
        }
        line += `${chipChar(chip.kind)}${chip.label}`
        if (!value.references.some((r) => r.kind === chip.kind && r.id === chip.id)) {
          value.references.push({ kind: chip.kind, id: chip.id, label: chip.label })
        }
      }
    }
    lines.push(line)
  }
  value.text = lines.join('\n')
  return value
}

/** Splits text at the `/<label>` and `@<label>` of its references, longest first. */
export function segments(
  text: string,
  references: readonly MessageReference[],
): (string | MessageReference)[] {
  const byLabel = new Map(
    references.filter((r) => r.label).map((r) => [`${chipChar(r.kind)}${r.label}`, r]),
  )
  if (byLabel.size === 0) return text ? [text] : []
  const pattern = [...byLabel.keys()]
    .toSorted((a, b) => b.length - a.length)
    .map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')
  return text
    .split(new RegExp(`(${pattern})`))
    .map((part, i) => (i % 2 === 1 ? (byLabel.get(part) ?? part) : part))
    .filter((part) => part !== '')
}

/** The input holding a sent message again. */
export function promptDoc(text: string, references: readonly MessageReference[] = []): JSONContent {
  const content: JSONContent[] = []
  text.split('\n').forEach((line, i) => {
    if (i > 0) content.push({ type: 'hardBreak' })
    for (const part of segments(line, references)) {
      content.push(typeof part === 'string' ? { type: 'text', text: part } : chipNode(part))
    }
  })
  return { type: 'doc', content: [{ type: 'paragraph', content }] }
}
