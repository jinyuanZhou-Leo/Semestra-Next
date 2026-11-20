import type { Token, Tokens } from 'marked'
import type { ReactNode } from 'react'
import { m } from '@/paraglide/messages'
import { Checkbox } from '@/ui/checkbox'
import { EDITOR_RULES, type TaskItem } from './editor-rules'
import { isAllowedHref } from './href'
import { BREAK, noteMarked } from './note-marked'

/**
 * A note as it reads (M14 §4), without loading the editor: the note's Markdown read with the same
 * `marked` settings and drawn as the same elements the editor draws (`extensions.ts`), so
 * `note.css` styles both and nothing moves when editing starts. `view.test.tsx` compares the two
 * for every kind of content a note holds.
 */
type Mark =
  | { type: 'link'; href: string; title?: string }
  | { type: 'bold' | 'italic' | 'strike' | 'code' }
type Run = { text: string; marks: Mark[] } | { br: true }

/** The order the editor nests marks in (its schema's order). */
const RANK = ['link', 'bold', 'code', 'italic', 'strike'] as const

/** A note with nothing in it, as the editor sees it. */
const EMPTY = /^(?:\s|&nbsp;|\u00A0)*$/

/** An empty paragraph, as the editor writes one. */
const NBSP = /^(?:&nbsp;|\u00A0)\s*$/

const ENTITY = /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|(lt|gt|quot|amp));/g
const NAMED: Record<string, string> = { lt: '<', gt: '>', quot: '"', amp: '&' }
const decode = (text: string) =>
  text.replace(ENTITY, (_, dec?: string, hex?: string, name?: string) => {
    if (name) return NAMED[name] ?? ''
    const code = dec ? Number(dec) : Number.parseInt(hex ?? '', 16)
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '�'
  })

function runs(tokens: Token[] = [], marks: Mark[] = []): Run[] {
  return tokens.flatMap((token): Run[] => {
    switch (token.type) {
      case 'text':
        return token.tokens
          ? runs(token.tokens, marks)
          : [{ text: decode((token as Tokens.Text).text), marks }]
      case 'escape':
        return [{ text: (token as Tokens.Escape).text, marks }]
      case 'codespan':
        return [
          { text: decode((token as Tokens.Codespan).text), marks: [...marks, { type: 'code' }] },
        ]
      case 'strong':
        return runs(token.tokens, [...marks, { type: 'bold' }])
      case 'em':
        return runs(token.tokens, [...marks, { type: 'italic' }])
      case 'del':
        return runs(token.tokens, [...marks, { type: 'strike' }])
      case 'link': {
        const { href, title } = token as Tokens.Link
        return runs(token.tokens, [...marks, { type: 'link', href, title: title ?? undefined }])
      }
      case 'br':
        return [{ br: true }]
      case 'html':
        return BREAK.test(token.raw) ? [{ br: true }] : [{ text: token.raw, marks }]
      default:
        return 'tokens' in token && token.tokens
          ? runs(token.tokens, marks)
          : [{ text: 'text' in token ? String(token.text) : token.raw, marks }]
    }
  })
}

const plain = (tokens: Token[]) =>
  runs(tokens)
    .map((run) => ('text' in run ? run.text : ''))
    .join('')

const sameMark = (a: Mark, b: Mark) =>
  a.type === b.type &&
  (a.type !== 'link' || (b.type === 'link' && a.href === b.href && a.title === b.title))

function markElement(mark: Mark, children: ReactNode[], key: number): ReactNode {
  switch (mark.type) {
    case 'link':
      return (
        <a
          key={key}
          target="_blank"
          rel="noopener noreferrer nofollow"
          href={isAllowedHref(mark.href) ? mark.href : ''}
          title={mark.title}
        >
          {children}
        </a>
      )
    case 'bold':
      return <strong key={key}>{children}</strong>
    case 'italic':
      return <em key={key}>{children}</em>
    case 'strike':
      return <s key={key}>{children}</s>
    case 'code':
      return <code key={key}>{children}</code>
  }
}

/** A paragraph's text, with marks opened and closed the way the editor's DOM serializer does. */
function inline(tokens: Token[] = []): ReactNode[] {
  const list: Run[] = []
  for (const run of runs(tokens)) {
    const last = list.at(-1)
    if ('text' in run && run.text === '') continue
    if (
      last &&
      'text' in last &&
      'text' in run &&
      last.marks.length === run.marks.length &&
      last.marks.every((mark) => run.marks.some((other) => sameMark(mark, other)))
    ) {
      list[list.length - 1] = { text: last.text + run.text, marks: last.marks }
    } else list.push(run)
  }
  // The open marks, outermost first, each with the children collected so far.
  const root: ReactNode[] = []
  const open: { mark: Mark; children: ReactNode[] }[] = []
  let key = 0
  const close = (depth: number) => {
    while (open.length > depth) {
      const done = open.pop()
      if (!done) break
      ;(open.at(-1)?.children ?? root).push(markElement(done.mark, done.children, key++))
    }
  }
  for (const run of list) {
    const marks =
      'text' in run
        ? [...run.marks].sort((a, b) => RANK.indexOf(a.type) - RANK.indexOf(b.type))
        : []
    let keep = 0
    const same = (i: number) => {
      const [held, wanted] = [open[i], marks[i]]
      return held !== undefined && wanted !== undefined && sameMark(held.mark, wanted)
    }
    while (same(keep)) keep++
    close(keep)
    for (const mark of marks.slice(keep)) open.push({ mark, children: [] })
    ;(open.at(-1)?.children ?? root).push('text' in run ? run.text : <br key={key++} />)
  }
  close(0)
  // An empty paragraph, or one ending in a line break, gets the editor's trailing break.
  if (list.length === 0 || 'br' in (list.at(-1) ?? {}))
    root.push(<br key={key} className="ProseMirror-trailingBreak" />)
  return root
}

/** A checklist item ticked: its place in reading order, the new state and the item's text. */
export type Toggle = (index: number, checked: boolean, text: string) => void

const NO_TICKS: ReadonlyMap<number, boolean> = new Map()

type Counter = {
  next: number
  onToggle: Toggle
  ticks: ReadonlyMap<number, boolean>
}

const EMPTY_LINE = (key: string) => (
  <p key={key}>
    <br className="ProseMirror-trailingBreak" />
  </p>
)

/**
 * A block's children. Where the editor keeps blank lines (the note itself, list items and
 * quotes), a run of them between blocks is an empty paragraph for each blank line after the first.
 */
function blocks(tokens: Token[], tasks: Counter, keepBlankLines: boolean): ReactNode[] {
  // Trailing blank lines a block took into its own source count as a gap after it.
  const list = keepBlankLines
    ? tokens.flatMap((token, i): Token[] => {
        const own = token.type !== 'space' && tokens[i + 1]?.type !== 'space'
        const trailing = own ? /\n{2,}$/.exec(token.raw) : null
        return trailing ? [token, { type: 'space', raw: trailing[0] } as Tokens.Space] : [token]
      })
    : tokens
  const filled = list.flatMap((token, i) => (token.type === 'space' ? [] : [i]))
  return mergeLists(list).flatMap((token, i): ReactNode[] => {
    if (token.type !== 'space') return [block(token, tasks, `${i}`)]
    if (!keepBlankLines) return []
    const between = filled.some((at) => at < i) && filled.some((at) => at > i)
    const count = Math.max((token.raw.match(/\n\n/g) ?? []).length - (between ? 1 : 0), 0)
    return Array.from({ length: count }, (_, n) => EMPTY_LINE(`${i}.${n}`))
  })
}

/** The editor reads `1.` and `2)` as one numbered list, where GFM starts a new one. */
function mergeLists(tokens: Token[]): Token[] {
  return tokens.reduce<Token[]>((merged, token) => {
    const last = merged.at(-1)
    if (token.type === 'list' && last?.type === 'list' && token.ordered && last.ordered) {
      merged[merged.length - 1] = { ...last, items: [...last.items, ...token.items] }
    } else merged.push(token)
    return merged
  }, [])
}

function block(token: Token, tasks: Counter, key: string): ReactNode {
  switch (token.type) {
    case 'paragraph':
    case 'text':
      // The editor stores a deliberately empty line as `&nbsp;`.
      return <p key={key}>{inline(NBSP.test(token.raw) ? [] : (token.tokens ?? [token]))}</p>
    case 'heading': {
      const Tag = `h${(token as Tokens.Heading).depth}` as 'h1'
      return <Tag key={key}>{inline(token.tokens)}</Tag>
    }
    case 'code': {
      const { lang, text } = token as Tokens.Code
      return (
        <pre key={key}>
          <code className={lang ? `language-${lang}` : undefined}>{text}</code>
        </pre>
      )
    }
    case 'blockquote':
      return <blockquote key={key}>{blocks(token.tokens ?? [], tasks, true)}</blockquote>
    case 'hr':
      return <hr key={key} />
    case 'list':
      return listBlock(token as Tokens.List, tasks, key)
    case 'taskList':
      return checklist(token.items as TaskItem[], tasks, key)
    case 'table':
      return tableBlock(token as Tokens.Table, key)
    default:
      return null
  }
}

/** A checklist, drawn as the editor's node view draws each row (`TaskItemView`). */
function checklist(items: TaskItem[], tasks: Counter, key: string): ReactNode {
  return (
    <ul key={key} data-type="taskList">
      {items.map((item, i) => {
        const index = tasks.next++
        const checked = tasks.ticks.get(index) ?? item.checked
        return (
          <li key={i} data-checked={checked} style={{ whiteSpace: 'normal' }}>
            <span contentEditable={false} className="flex h-[1lh] items-center">
              <Checkbox
                checked={checked}
                aria-label={m.sticky_task_label({ text: plain(item.tokens) })}
                onCheckedChange={(next) => tasks.onToggle(index, next === true, plain(item.tokens))}
              />
            </span>
            <div style={{ whiteSpace: 'pre-wrap' }}>
              <p>{inline(item.tokens)}</p>
              {blocks(item.nestedTokens ?? [], tasks, false)}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/** The checkbox's text and the lines under it, as the editor reads a GFM checklist item. */
function taskItem(item: Tokens.ListItem): TaskItem {
  const [first = '', ...rest] = item.raw.split('\n')
  const main = /^\s*[-+*]\s+\[[ xX]\]\s+(.*)$/.exec(first)?.[1] ?? ''
  const filled = rest.filter((line) => line.trim())
  const indent = Math.min(...filled.map((line) => line.length - line.trimStart().length))
  const nested = rest
    .map((line) => (line.trim() ? line.slice(indent) : ''))
    .join('\n')
    .trim()
  const lexer = noteMarked().use(EDITOR_RULES)
  return {
    checked: item.checked === true,
    tokens: lexer.Lexer.lexInline(main, lexer.defaults),
    nestedTokens: nested ? lexer.lexer(`${nested}\n`) : [],
  }
}

/**
 * A numbered item starting `[ ]` is text in the editor (only bulleted items are checklist
 * items), so the box goes back into the item's text.
 */
function untask(tokens: Token[]): Token[] {
  const box = tokens.find((t) => t.type === 'checkbox')
  if (!box) return tokens
  let done = false
  return tokens.flatMap((t): Token[] => {
    if (t === box) return []
    if (done || t.type !== 'text') return [t]
    done = true
    const lead = { type: 'text', raw: box.raw, text: box.raw } as Token
    return [{ ...t, tokens: [lead, ...(t.tokens ?? [])] } as Token]
  })
}

/**
 * A list; in a bulleted list, checklist items and plain items become separate lists, as in the
 * editor.
 */
function listBlock(token: Tokens.List, tasks: Counter, key: string): ReactNode {
  const groups: Tokens.ListItem[][] = []
  for (const item of token.ordered
    ? token.items.map((i) => ({ ...i, task: false, tokens: untask(i.tokens) }))
    : token.items) {
    const last = groups.at(-1)
    if (last && last[0]?.task === item.task) last.push(item)
    else groups.push([item])
  }
  return groups.map((items, g) => {
    if (items[0]?.task) return checklist(items.map(taskItem), tasks, `${key}.${g}`)
    const Tag = token.ordered ? 'ol' : 'ul'
    const start = token.ordered && g === 0 && token.start !== 1 ? Number(token.start) : undefined
    return (
      <Tag key={`${key}.${g}`} start={start}>
        {items.map((item, i) => {
          // A heading's marker at the start of an item is the item's text.
          const [first, ...rest] = item.tokens
          // In a numbered item the editor keeps the `#` as text.
          const content =
            first?.type === 'heading'
              ? [
                  token.ordered
                    ? ({
                        type: 'paragraph',
                        raw: first.raw,
                        tokens: [{ type: 'text', raw: first.raw, text: first.raw.trim() }],
                      } as Token)
                    : ({ ...first, type: 'paragraph' } as Token),
                  ...rest,
                ]
              : item.tokens
          // The editor reads numbered lists with its own rule, which drops blank lines.
          return <li key={i}>{blocks(content, tasks, !token.ordered)}</li>
        })}
      </Tag>
    )
  })
}

function tableBlock(token: Tokens.Table, key: string): ReactNode {
  const cell = (c: Tokens.TableCell, i: number) => {
    const Tag = c.header ? 'th' : 'td'
    const align = token.align[i]
    return (
      <Tag key={i} style={align ? { textAlign: align } : undefined}>
        <p>{inline(c.tokens)}</p>
      </Tag>
    )
  }
  return (
    <div key={key} className="tableWrapper">
      <table style={{ minWidth: `${token.header.length * 25}px` }}>
        <colgroup>
          {token.header.map((_, i) => (
            <col key={i} style={{ minWidth: '25px' }} />
          ))}
        </colgroup>
        <tbody>
          <tr>{token.header.map(cell)}</tr>
          {token.rows.map((row, r) => (
            <tr key={r}>{row.map(cell)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * The note's text, read-only. `onToggle` gets a checklist item's place in the note (in reading
 * order) and text; `ticks` shows ticks that are still being saved.
 */
export function NoteView({
  content,
  placeholder,
  onToggle,
  ticks = NO_TICKS,
}: {
  content: string
  placeholder: string
  onToggle: Toggle
  ticks?: ReadonlyMap<number, boolean>
}) {
  const tokens = noteMarked().use(EDITOR_RULES).lexer(content)
  const nodes = blocks(tokens, { next: 0, onToggle, ticks }, true)
  return (
    <div
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- the editor's own element (a read-only text box), so the note reads the same before and after the editor loads
      role="textbox"
      aria-label={m.sticky_card_title()}
      translate="no"
      contentEditable={false}
      className="tiptap ProseMirror sticky-note"
    >
      {!EMPTY.test(content) ? (
        nodes
      ) : (
        <p data-placeholder={placeholder} className="is-empty is-editor-empty">
          <br className="ProseMirror-trailingBreak" />
        </p>
      )}
    </div>
  )
}
