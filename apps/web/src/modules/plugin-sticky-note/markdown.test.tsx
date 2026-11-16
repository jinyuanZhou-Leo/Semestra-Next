import { Editor } from '@tiptap/core'
import { expect, test } from 'vitest'
import { noteExtensions } from './extensions'

function editor(content: string) {
  return new Editor({
    extensions: noteExtensions({ placeholder: '', onTooLong: () => {} }),
    content,
    contentType: 'markdown',
  })
}

const roundTrip = (content: string) => editor(content).getMarkdown()

test('a note is plain Markdown: HTML-looking text, < and & are kept as typed', () => {
  for (const text of [
    'a <b>tag</b> and <img src=x onerror=alert(1)>',
    'compare <vector> & a<c',
    'price $5 & tax_rate',
  ])
    expect(roundTrip(text)).toBe(text)
  // An entity typed as text stays text.
  const e = editor('')
  e.commands.insertContent('write &amp; for &')
  expect(editor(e.getMarkdown()).getText()).toBe('write &amp; for &')
  expect(editor('<b>bold?</b>').getJSON().content?.[0]?.content).toEqual([
    { type: 'text', text: '<b>bold?</b>' },
  ])
})

test('a single line break stays a line break', () => {
  expect(roundTrip('line one\nline two')).toBe('line one\nline two')
})

test('a table cell holds text only, so what is shown is what is stored', () => {
  const e = editor('| a | b |\n| --- | --- |\n| 1 | 2 |')
  // Into the header cell "a".
  e.commands.setTextSelection(4)
  expect(e.isActive('table')).toBe(true)
  expect(e.can().toggleTaskList()).toBe(false)
  e.commands.setHardBreak()
  e.commands.insertContent('x')
  const stored = e.getMarkdown()
  expect(stored).toContain('<br>x')
  expect(roundTrip(stored)).toBe(stored)
})

test('text that would start a list, heading, quote or rule at the start of a line stays text', () => {
  for (const line of [
    '- not a list',
    '+ not a list',
    '1. not ol',
    '2) not ol',
    '# not heading',
    '> not quote',
    '---',
    '| a | b |',
  ])
    for (const text of [line, `first\n${line}`]) {
      const e = editor('')
      e.commands.insertContent(text.replace('\n', '<br>'))
      const stored = e.getMarkdown()
      expect(editor(stored).getText({ blockSeparator: '\n' })).toBe(
        e.getText({ blockSeparator: '\n' }),
      )
      expect(
        editor(stored)
          .getJSON()
          .content?.map((n) => n.type),
      ).toEqual(['paragraph'])
    }
  // A setext underline after a line break.
  const e = editor('')
  e.commands.insertContent('title<br>===')
  expect(
    editor(e.getMarkdown())
      .getJSON()
      .content?.map((n) => n.type),
  ).toEqual(['paragraph'])
})
