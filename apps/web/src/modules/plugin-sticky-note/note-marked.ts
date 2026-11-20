import { Marked } from 'marked'

/**
 * How a note's Markdown is read (M14 §4): GFM (tables, checklists), a single line break is a line
 * break, and no HTML: `<`, `>` and `&` are text. The only tag read is `<br>`, which tables use for
 * a break inside a cell. A new instance each time: the editor registers its own tokenizers on the
 * one it is given, and the read-only view (`NoteView`) must keep reading plain GFM.
 */
export const BREAK = /^<br\s*\/?>/i

export function noteMarked() {
  return new Marked({
    gfm: true,
    breaks: true,
    tokenizer: {
      // No match makes marked read the source as text; `false` falls back to the built-in rule.
      html: () => undefined,
      tag: (src: string) => (BREAK.test(src) ? false : undefined),
    },
  })
}
