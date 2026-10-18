import { expect, test } from 'vitest'
import { applyFormat } from './format'

test('bold and italic wrap the selection, and unwrap it when pressed again', () => {
  const bold = applyFormat('bold', { text: 'a word b', start: 2, end: 6 })
  expect(bold).toEqual({ text: 'a **word** b', start: 4, end: 8 })
  expect(applyFormat('bold', { text: bold.text, start: 2, end: 10 }).text).toBe('a word b')
  expect(applyFormat('italic', { text: 'x', start: 0, end: 1 }).text).toBe('*x*')
})

test('with nothing selected the marks surround the cursor', () => {
  expect(applyFormat('bold', { text: 'ab', start: 1, end: 1 })).toEqual({
    text: 'a****b',
    start: 3,
    end: 3,
  })
})

test('list and task prefix every selected line and remove the prefix when all have it', () => {
  const text = 'one\ntwo\nthree'
  const listed = applyFormat('list', { text, start: 0, end: 7 })
  expect(listed.text).toBe('- one\n- two\nthree')
  expect(applyFormat('list', { text: listed.text, start: 0, end: 11 }).text).toBe(text)
  expect(applyFormat('task', { text: 'buy milk', start: 3, end: 3 }).text).toBe('- [ ] buy milk')
})

test('a link keeps the selected text as its label and selects the address', () => {
  const edit = applyFormat('link', { text: 'see docs now', start: 4, end: 8 })
  expect(edit.text).toBe('see [docs](https://) now')
  expect(edit.text.slice(edit.start, edit.end)).toBe('https://')
})
