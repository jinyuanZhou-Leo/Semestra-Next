import type { MarkedExtension, Token } from 'marked'

/**
 * Where the editor reads a note's Markdown differently from GFM, the read-only view (`NoteView`)
 * reads it the same way: Tiptap 3.32's own tokenizers for checklists (`TaskList`, on core's
 * `parseIndentedBlocks`) and tables (`Table`, on `escapeTableCellPipes`). They are copied rather
 * than imported because importing them brings ProseMirror along, the very thing the view
 * avoids loading. `view.test.tsx` compares the view with the editor, so a Tiptap upgrade that
 * changes these rules fails there.
 */
export type TaskItem = { checked: boolean; tokens: Token[]; nestedTokens?: Token[] }

type Lexer = {
  inlineTokens: (src: string) => Token[]
  blockTokens: (src: string) => Token[]
}

const TASK_ITEM = /^(\s*)[-+*]\s+\[([ xX])\]\s+(.*)$/
const indentOf = (line: string) => /^\s*/.exec(line)?.[0].length ?? 0

/** Removes `size` columns of indentation, a tab reaching the next multiple of 4. */
function dedent(line: string, size: number) {
  return line.replace(/^[ \t]*/, (whitespace) => {
    let columns = 0
    for (const character of whitespace) columns += character === '\t' ? 4 - (columns % 4) : 1
    return ' '.repeat(Math.max(0, columns - size))
  })
}

/** Whether `line` carries on an open paragraph (rather than starting a block). */
function continuesParagraph(line: string, lexer: Lexer) {
  const source = `text\n${line}\n`
  const [token] = lexer.blockTokens(source)
  return (token?.type === 'paragraph' || token?.type === 'text') && token.raw === source
}

/** A checklist at the start of `src`: its items, each with what is indented under it. */
function taskList(src: string, lexer: Lexer): { raw: string; items: TaskItem[] } | undefined {
  const lines = src.split('\n')
  const items: TaskItem[] = []
  let raw = ''
  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ''
    const match = TASK_ITEM.exec(line)
    if (!match) {
      if (items.length > 0) break
      if (line.trim() !== '') return undefined
      raw += `${line}\n`
      i += 1
      continue
    }
    const [, indent = '', mark = '', main = ''] = match
    const level = indent.length
    raw += `${line}\n`
    i += 1
    const under: string[] = []
    while (i < lines.length) {
      const next = lines[i] ?? ''
      if (next.trim() === '') {
        // A blank line belongs to the item only if more indented text follows.
        const following = lines.slice(i + 1).find((l) => l.trim() !== '')
        if (following === undefined || indentOf(following) <= level) break
      } else if (indentOf(next) <= level) break
      under.push(next)
      raw += `${next}\n`
      i += 1
    }
    // Lines that carry on the item's paragraph are its text; the rest is nested content.
    const dedented = under.map((l) => dedent(l, level + 2))
    let carried = 0
    while (carried < dedented.length) {
      const next = dedented[carried] ?? ''
      if (!next.trim() || !continuesParagraph(next, lexer)) break
      carried += 1
    }
    const text = [main, ...dedented.slice(0, carried).map((l) => l.trimStart())].join('\n')
    const nested = dedented.slice(carried).join('\n')
    items.push({
      checked: mark.toLowerCase() === 'x',
      tokens: lexer.inlineTokens(text),
      nestedTokens: nested.trim() ? nestedBlocks(nested, lexer) : undefined,
    })
  }
  return items.length > 0 ? { raw: raw.slice(0, src.length), items } : undefined
}

function nestedBlocks(content: string, lexer: Lexer): Token[] {
  const inner = taskList(content, lexer)
  if (!inner) return lexer.blockTokens(content)
  const list = { type: 'taskList', raw: inner.raw, items: inner.items } as unknown as Token
  const rest = content.slice(inner.raw.length)
  return rest.trim() ? [list, ...lexer.blockTokens(rest)] : [list]
}

/** Escapes a `|` inside inline code in a table row, so it does not split the cell. */
function escapeCodePipes(line: string): string {
  let result = ''
  let i = 0
  while (i < line.length) {
    if (line[i] === '\\' && i + 1 < line.length) {
      result += line.slice(i, i + 2)
      i += 2
      continue
    }
    if (line[i] !== '`') {
      result += line[i++]
      continue
    }
    let run = 0
    while (line[i + run] === '`') run += 1
    let j = i + run
    let closed = false
    while (j < line.length) {
      if (line[j] !== '`') {
        j += 1
        continue
      }
      let close = 0
      while (line[j + close] === '`') close += 1
      if (close === run) {
        const code = line.slice(i + run, j).replace(/\\\||\|/g, (m) => (m === '|' ? '\\|' : m))
        result += line.slice(i, i + run) + code + line.slice(j, j + run)
        i = j + run
        closed = true
        break
      }
      j += close
    }
    if (!closed) {
      result += line.slice(i, i + run)
      i += run
    }
  }
  return result
}

const escapeTablePipes = (src: string) =>
  src
    .split('\n')
    .map((line) => (line.includes('|') && line.includes('`') ? escapeCodePipes(line) : line))
    .join('\n')

export const EDITOR_RULES: MarkedExtension = {
  extensions: [
    {
      name: 'table',
      level: 'block',
      start: (src) => {
        const [head = '', sep = ''] = src.split('\n')
        return /^[ \t|:]*-[ \t|:-]*$/.test(sep) && sep.includes('|') && head.includes('|') ? 0 : -1
      },
      tokenizer(src) {
        const blank = src.indexOf('\n\n')
        const candidate = blank >= 0 ? src.slice(0, blank) : src
        const fixed = escapeTablePipes(candidate)
        if (fixed === candidate) return undefined
        const [table] = this.lexer.blockTokens(fixed, [])
        if (table?.type !== 'table') return undefined
        const lines = table.raw.split('\n').length
        return { ...table, raw: src.split('\n').slice(0, lines).join('\n') }
      },
    },
    {
      name: 'taskList',
      level: 'block',
      start: (src) => src.match(/^\s*[-+*]\s+\[([ xX])\]\s+/)?.index ?? -1,
      tokenizer(src) {
        const { lexer } = this
        const result = taskList(src, {
          inlineTokens: (text) => lexer.inlineTokens(text),
          blockTokens: (text) => {
            const top = lexer.state.top
            const tokens = lexer.blockTokens(text)
            lexer.state.top = top
            return tokens
          },
        })
        return result ? { type: 'taskList', raw: result.raw, items: result.items } : undefined
      },
    },
  ],
}
