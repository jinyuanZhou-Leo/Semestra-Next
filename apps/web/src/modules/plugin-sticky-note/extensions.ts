import { TaskItem, TaskList } from '@tiptap/extension-list'
import { TableCell, TableHeader, TableKit } from '@tiptap/extension-table'
import { Placeholder } from '@tiptap/extensions'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { StarterKit } from '@tiptap/starter-kit'
import { NoteLimit } from './limit'
import { OpenLinkOnModClick } from './links'
import { NoteHardBreak, NoteMarkdown } from './markdown'
import { MarkdownInput } from './markdown-input'
import { NOTE_MAX_CHARS } from './schema'
import { TaskItemView } from './TaskItemView'

/**
 * The note's editor (M14 §4): Tiptap with its official extensions, read from and written back
 * to Markdown (`markdown.ts`), so the agent (`sticky.note.*`) and the card share one format. The
 * schema allows only what that Markdown can hold: a table cell is one paragraph of text, since a
 * GFM table cannot store lists or several paragraphs in a cell.
 */
export function noteExtensions({
  placeholder,
  onTooLong,
}: {
  placeholder: string
  onTooLong: () => void
}) {
  return [
    StarterKit.configure({
      hardBreak: false,
      link: { openOnClick: false, autolink: true, protocols: ['mailto'] },
      // A note is a few lines: headings, quotes and code blocks still come in from Markdown.
      trailingNode: false,
    }),
    NoteHardBreak,
    TaskList,
    TaskItem.extend({ addNodeView: () => ReactNodeViewRenderer(TaskItemView) }).configure({
      nested: true,
    }),
    TableKit.configure({ table: { resizable: false }, tableCell: false, tableHeader: false }),
    TableCell.extend({ content: 'paragraph' }),
    TableHeader.extend({ content: 'paragraph' }),
    // An empty note says what it is for while read-only too; a click on it starts editing.
    Placeholder.configure({ placeholder, showOnlyWhenEditable: false }),
    NoteMarkdown,
    MarkdownInput,
    OpenLinkOnModClick,
    NoteLimit.configure({ max: NOTE_MAX_CHARS, onRefuse: onTooLong }),
  ]
}
