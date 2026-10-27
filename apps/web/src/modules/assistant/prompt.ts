import type { JSONContent } from '@tiptap/core'

/** A course or term picked with `@`: the text holds it as `@<label>`. */
export type MessageReference = { kind: 'course' | 'term'; id: string; label: string }

/** What a chip in the input stands for: a skill or `/compact` (first), or a reference. */
export type Chip = { kind: 'skill' | 'command'; id: string; label: string } | MessageReference

/** What the input holds, as it is sent. */
export type PromptValue = {
  text: string
  /** The skill chosen with `/`, by name. */
  skill: string | null
  /** `/compact` was chosen: the text says what to keep. */
  compact: boolean
  references: MessageReference[]
}

export const EMPTY_PROMPT: PromptValue = { text: '', skill: null, compact: false, references: [] }

const lead = (kind: Chip['kind']) => kind === 'skill' || kind === 'command'

/** The editor node of a chip (Tiptap's `mention`, its kind and id in `id`). */
export function chipNode(chip: Chip): JSONContent {
  return {
    type: 'mention',
    attrs: {
      id: `${chip.kind}:${chip.id}`,
      label: chip.label,
      mentionSuggestionChar: lead(chip.kind) ? '/' : '@',
    },
  }
}

export function chipOf(attrs: Record<string, unknown> | undefined): Chip | null {
  const raw = typeof attrs?.id === 'string' ? attrs.id : ''
  const at = raw.indexOf(':')
  const kind = raw.slice(0, at)
  const label = typeof attrs?.label === 'string' ? attrs.label : ''
  if (kind === 'skill' || kind === 'command' || kind === 'course' || kind === 'term') {
    return { kind, id: raw.slice(at + 1), label }
  }
  return null
}

/** Reads what the input holds: references become `@<label>` in the text. */
export function readPrompt(doc: JSONContent): PromptValue {
  const value: PromptValue = { text: '', skill: null, compact: false, references: [] }
  const lines: string[] = []
  for (const block of doc.content ?? []) {
    let line = ''
    for (const node of block.content ?? []) {
      if (node.type === 'text') line += node.text ?? ''
      else if (node.type === 'hardBreak') line += '\n'
      else if (node.type === 'mention') {
        const chip = chipOf(node.attrs)
        if (!chip) continue
        if (chip.kind === 'skill') value.skill ??= chip.id
        else if (chip.kind === 'command') value.compact = true
        else {
          const ref: MessageReference = { kind: chip.kind, id: chip.id, label: chip.label }
          line += `@${ref.label}`
          if (!value.references.some((r) => r.kind === ref.kind && r.id === ref.id)) {
            value.references.push(ref)
          }
        }
      }
    }
    lines.push(line)
  }
  value.text = lines.join('\n')
  return value
}

/** Splits text at the `@<label>` of its references, longest labels first. */
export function segments(
  text: string,
  references: readonly MessageReference[],
): (string | MessageReference)[] {
  const byLabel = new Map(references.map((r) => [`@${r.label}`, r]))
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

/** The input holding a sent message again: `first` (a skill chip) before its text. */
export function promptDoc(
  text: string,
  references: readonly MessageReference[] = [],
  first: Chip | null = null,
): JSONContent {
  const content: JSONContent[] = first ? [chipNode(first), { type: 'text', text: ' ' }] : []
  text.split('\n').forEach((line, i) => {
    if (i > 0) content.push({ type: 'hardBreak' })
    for (const part of segments(line, references)) {
      content.push(typeof part === 'string' ? { type: 'text', text: part } : chipNode(part))
    }
  })
  return { type: 'doc', content: [{ type: 'paragraph', content }] }
}
