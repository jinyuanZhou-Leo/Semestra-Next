// node --test scripts/release.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseNote, today } from './release.mjs'

test('splits the English and Chinese notes', () => {
  const note = parseNote('<!-- en -->\nAdd tasks.\n\n<!-- zh -->\n新增待办。\n', 'minor')
  assert.deepEqual(note, { kind: 'new', en: 'Add tasks.', zh: '新增待办。' })
})

test('takes the kind from its marker, defaulting by bump', () => {
  const body = '<!-- improved -->\n<!-- en -->\nFaster.\n<!-- zh -->\n更快。'
  assert.equal(parseNote(body, 'patch').kind, 'improved')
  assert.equal(parseNote('<!-- en -->\nA.\n<!-- zh -->\n甲。', 'patch').kind, 'fixed')
  assert.equal(parseNote('<!-- zh -->\n甲。\n<!-- en -->\nA.', 'major').en, 'A.')
})

test('rejects a missing section', () => {
  assert.match(parseNote('<!-- en -->\nOnly English.', 'minor'), /needs both/)
  assert.match(parseNote('Plain text.', 'minor'), /needs both/)
})

test('rejects a misspelled marker', () => {
  const note = parseNote('<!-- fix -->\n<!-- en -->\nA.\n<!-- zh -->\n甲。', 'patch')
  assert.match(note, /unknown marker <!-- fix -->/)
})

test('dates releases in the given time zone', () => {
  const evening = new Date('2026-10-23T01:30:00Z')
  assert.equal(today('UTC', evening), '2026-10-23')
  assert.equal(today('America/Toronto', evening), '2026-10-22')
})
