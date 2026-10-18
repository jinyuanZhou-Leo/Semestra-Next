/** Toolbar actions of the sticky note editor, as pure text edits (M14 §4). */

export type Edit = { text: string; start: number; end: number }
export type FormatKind = 'bold' | 'italic' | 'list' | 'task' | 'link'

function wrap(edit: Edit, mark: string): Edit {
  const { text, start, end } = edit
  const inner = text.slice(start, end)
  // Pressing it again on text that is already wrapped removes the marks.
  if (inner.startsWith(mark) && inner.endsWith(mark) && inner.length >= mark.length * 2) {
    const plain = inner.slice(mark.length, inner.length - mark.length)
    return {
      text: text.slice(0, start) + plain + text.slice(end),
      start,
      end: start + plain.length,
    }
  }
  return {
    text: `${text.slice(0, start)}${mark}${inner}${mark}${text.slice(end)}`,
    start: start + mark.length,
    end: end + mark.length,
  }
}

function prefixLines(edit: Edit, prefix: string): Edit {
  const { text, start, end } = edit
  const lineStart = text.lastIndexOf('\n', start - 1) + 1
  const nextBreak = text.indexOf('\n', end)
  const lineEnd = nextBreak === -1 ? text.length : nextBreak
  const lines = text.slice(lineStart, lineEnd).split('\n')
  const allPrefixed = lines.every((line) => line.startsWith(prefix))
  const next = lines
    .map((line) => (allPrefixed ? line.slice(prefix.length) : `${prefix}${line}`))
    .join('\n')
  const delta = next.length - (lineEnd - lineStart)
  return {
    text: text.slice(0, lineStart) + next + text.slice(lineEnd),
    start: Math.max(lineStart, start + (allPrefixed ? -prefix.length : prefix.length)),
    end: end + delta,
  }
}

function link(edit: Edit): Edit {
  const { text, start, end } = edit
  const label = text.slice(start, end) || 'link'
  const url = 'https://'
  const inserted = `[${label}](${url})`
  const urlStart = start + label.length + 3
  return {
    text: text.slice(0, start) + inserted + text.slice(end),
    start: urlStart,
    end: urlStart + url.length,
  }
}

export function applyFormat(kind: FormatKind, edit: Edit): Edit {
  switch (kind) {
    case 'bold':
      return wrap(edit, '**')
    case 'italic':
      return wrap(edit, '*')
    case 'list':
      return prefixLines(edit, '- ')
    case 'task':
      return prefixLines(edit, '- [ ] ')
    case 'link':
      return link(edit)
  }
}
