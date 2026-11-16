import { TaskItem, TaskList } from '@tiptap/extension-list'
import { TableKit } from '@tiptap/extension-table'
import { Placeholder } from '@tiptap/extensions'
import { Markdown } from '@tiptap/markdown'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { StarterKit } from '@tiptap/starter-kit'
import { MarkdownInput } from './markdown-input'
import { TaskItemView } from './TaskItemView'

/**
 * The note's editor (M14 §4): Tiptap with its official extensions, read from and written back
 * to Markdown, so the agent (`sticky.note.*`) and the card share one plain-text format.
 */
export function noteExtensions(placeholder: string) {
  return [
    StarterKit.configure({
      link: { openOnClick: false, autolink: true, protocols: ['mailto'] },
      // A note is a few lines: headings, quotes and code blocks still come in from Markdown.
      trailingNode: false,
    }),
    TaskList,
    TaskItem.extend({ addNodeView: () => ReactNodeViewRenderer(TaskItemView) }).configure({
      nested: true,
    }),
    TableKit.configure({ table: { resizable: false } }),
    Placeholder.configure({ placeholder }),
    Markdown.configure({ markedOptions: { gfm: true, breaks: true } }),
    MarkdownInput,
  ]
}
