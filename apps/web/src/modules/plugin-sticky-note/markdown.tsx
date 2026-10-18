import type { ReactNode } from 'react'

/**
 * The small Markdown subset sticky notes support (M14 §4): paragraphs, **bold**, *italic*,
 * bullet lists, checkbox lists and links. Rendered to React elements, never to HTML, so note
 * content cannot inject markup. No dependency: a full Markdown library costs far more than the
 * handful of constructs the editor offers.
 */

type Block =
  | { kind: 'paragraph'; line: number; text: string }
  | { kind: 'bullet'; line: number; text: string }
  | { kind: 'task'; line: number; text: string; checked: boolean }
  | { kind: 'gap'; line: number }

const TASK = /^\s*[-*]\s+\[([ xX])\]\s?(.*)$/
const BULLET = /^\s*[-*]\s+(.*)$/

export function parseBlocks(content: string): Block[] {
  return content.split('\n').map((raw, line): Block => {
    const task = TASK.exec(raw)
    if (task) return { kind: 'task', line, text: task[2] ?? '', checked: task[1] !== ' ' }
    const bullet = BULLET.exec(raw)
    if (bullet) return { kind: 'bullet', line, text: bullet[1] ?? '' }
    if (raw.trim() === '') return { kind: 'gap', line }
    return { kind: 'paragraph', line, text: raw }
  })
}

/** Flips the checkbox on `line`; returns the content unchanged when that line is not a task. */
export function toggleTask(content: string, line: number): string {
  const lines = content.split('\n')
  const current = lines[line]
  if (current === undefined || !TASK.test(current)) return content
  lines[line] = current.replace(/\[([ xX])\]/, (_m, mark: string) => (mark === ' ' ? '[x]' : '[ ]'))
  return lines.join('\n')
}

const SAFE_URL = /^(https?:\/\/|mailto:)/i
const INLINE = /\*\*(.+?)\*\*|\*(.+?)\*|\[([^\]]+)\]\(([^)\s]+)\)/g

export function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let key = 0
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0
    if (index > last) out.push(text.slice(last, index))
    const [whole, bold, italic, label, url] = match
    if (bold !== undefined) {
      out.push(<strong key={key++}>{renderInline(bold)}</strong>)
    } else if (italic !== undefined) {
      out.push(<em key={key++}>{renderInline(italic)}</em>)
    } else if (label !== undefined && url !== undefined) {
      out.push(
        SAFE_URL.test(url) ? (
          <a
            key={key++}
            href={url}
            target="_blank"
            rel="noreferrer noopener"
            className="underline underline-offset-2"
          >
            {label}
          </a>
        ) : (
          whole
        ),
      )
    }
    last = index + whole.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function Markdown({
  content,
  onToggleTask,
  taskLabel,
}: {
  content: string
  /** Called with the new content when a checkbox is clicked; omit for a read-only view. */
  onToggleTask?: (content: string) => void
  /** Accessible name of a checkbox, given the task's text. */
  taskLabel: (text: string) => string
}) {
  return (
    <div className="space-y-1 text-sm break-words">
      {parseBlocks(content).map((block) => {
        switch (block.kind) {
          case 'gap':
            return <div key={block.line} className="h-2" aria-hidden />
          case 'paragraph':
            return <p key={block.line}>{renderInline(block.text)}</p>
          case 'bullet':
            return (
              <p key={block.line} className="flex gap-2">
                <span aria-hidden>•</span>
                <span>{renderInline(block.text)}</span>
              </p>
            )
          case 'task':
            return (
              <label key={block.line} className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={block.checked}
                  disabled={!onToggleTask}
                  aria-label={taskLabel(block.text)}
                  onChange={() => onToggleTask?.(toggleTask(content, block.line))}
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                />
                <span className={block.checked ? 'text-muted-foreground line-through' : undefined}>
                  {renderInline(block.text)}
                </span>
              </label>
            )
        }
      })}
    </div>
  )
}
