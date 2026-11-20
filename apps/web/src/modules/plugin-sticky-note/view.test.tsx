import { render, waitFor } from '@testing-library/react'
import { Editor as Headless } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'
import { expect, test } from 'vitest'
import { noteExtensions } from './extensions'
import { NoteView } from './NoteView'

function Editor({ content }: { content: string }) {
  const editor = useEditor({
    editable: false,
    extensions: noteExtensions({ placeholder: 'Empty', onTooLong: () => {} }),
    content,
    contentType: 'markdown',
    editorProps: { attributes: { class: 'sticky-note' } },
  })
  return <EditorContent editor={editor} />
}

/** The editor's DOM without what only an editable document needs. */
function normalize(root: Element): string {
  const copy = root.cloneNode(true) as Element
  const unwrap = (selector: string) => {
    for (const el of copy.querySelectorAll(selector)) el.replaceWith(...el.childNodes)
  }
  unwrap('.react-renderer')
  unwrap('[data-node-view-content-react]')
  for (const el of copy.querySelectorAll('*')) {
    // Base UI's generated ids, the node view's bookkeeping, and a selected rule's outline.
    for (const name of [
      'id',
      'as',
      'data-node-view-wrapper',
      'data-node-view-content',
      'draggable',
    ])
      el.removeAttribute(name)
    el.classList.remove('ProseMirror-selectednode')
    // The placeholder marks the empty line at the cursor; it shows only on an empty note.
    if (!el.classList.contains('is-editor-empty') && el.classList.contains('is-empty')) {
      el.classList.remove('is-empty')
      el.removeAttribute('data-placeholder')
    }
    if (el.classList.length === 0) el.removeAttribute('class')
  }
  for (const name of [
    'aria-label',
    'aria-readonly',
    'class',
    'role',
    'translate',
    'contenteditable',
  ])
    copy.removeAttribute(name)
  return copy.outerHTML
}

const SAMPLES = [
  '',
  'plain text',
  'a\n\n\n\nb',
  'a\n\n&nbsp;\n\nb',
  'line1\nline2  spaced   out',
  '**bold** *it* ~~gone~~ `code` [link](https://e.com) **[bold link](https://e.com)** [**inner**](https://e.com)',
  '***both*** and **bold *nested* bold**',
  '&amp; &lt;b&gt; <b>x</b> & < > 5 &#65; &unknown;',
  '\\*not bold\\* tax\\_rate',
  '![img](http://x) after',
  'https://example.com bare',
  '# H1\n## H2\n### H3',
  '> quote\n> more\n\n> - [ ] in quote',
  '---',
  '```js\nx  =  1\n<b>\n```',
  '- one\n- two\n  - nested\n    1. deep',
  '1. a\n2. b',
  '3. c\n4. d',
  '- [ ] one\n- [x] **two**\n  - [ ] nested\n- plain',
  '- plain\n- [ ] task',
  '- loose\n\n- items',
  '| A | B |\n| --- | --- |\n| 1 | **2** |\n|  | x<br>y |',
  'text\n| A |\n| --- |\n| 1 |',
  'ends with break\\\n',
  '1. a\n2) b',
  '## **Bold** heading\n\nSetext\n===',
  '> > nested quote',
  '++under++ and _em_ and __strong__',
  '* [ ] star task\n+ [x] plus task',
  '- [ ] task\n\n  continued paragraph',
  '[t](https://e.com "title") <https://auto.link> me@example.com',
  '| L | C | R |\n| :-- | :-: | --: |\n| a | b | c |',
  '``a `tick` b``',
  '<div>block html</div>\n\nafter',
  '   indented line',
  'hard  \nbreak',
  '    indented code',
  '***',
  '1. one\n\n   para in item\n2. two',
  '- a\n\n\n- b',
  'x\n\n\n\n\n',
  '\n\n\nleading blanks',
  '[ref]\n\n[ref]: https://e.com',
  'a<br>b',
  '~single~ tilde',
  '- a\n* b',
  '> a\n>\n>\n>\n> b',
  '- [ ] a\n\n\n- [ ] b',
  '1. a\n\n\n2. b',
  '3. a\n4) b',
  '| a | `x|y` |\n| --- | --- |\n| 1 | 2 |',
  '1. **bold** item\n   - [ ] task under number\n2. # heading item',
  '- # heading item\n- Setext\n  ---',
  '- [ ] task\n  continued line\n  - [x] child\n    more\n- [ ] next',
  'Para\n- [ ] task right after',
  '> - [x] done in quote\n> - plain in quote',
  '&nbsp;',
  '\u00a0',
  'emoji 🎉 &#x1F600; &#0;',
]

/** Notes as the editor saves them, which is how most notes are written. */
const SAVED = SAMPLES.map((content) => {
  const editor = new Headless({
    element: null,
    extensions: noteExtensions({ placeholder: 'Empty', onTooLong: () => {} }),
    content,
    contentType: 'markdown',
  })
  const saved = editor.getMarkdown()
  editor.destroy()
  return saved
})

test.each([...SAMPLES, ...SAVED])(
  'the read-only view draws %j as the editor does',
  async (content) => {
    const editor = render(<Editor content={content} />)
    const view = render(<NoteView content={content} placeholder="Empty" onToggle={() => {}} />)
    const editorRoot = () => editor.container.querySelector('.ProseMirror') as Element
    await waitFor(() => expect(editorRoot()).not.toBeNull())
    // Checklist rows are React node views, drawn a moment later.
    await waitFor(() => expect(editorRoot().querySelectorAll('li > span:empty')).toHaveLength(0))
    expect(normalize(view.container.firstElementChild as Element)).toBe(normalize(editorRoot()))
  },
)
