// node --test scripts/release.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseNote, today } from './release.mjs'

const AREA = '<!-- area: general -->\n'

test('splits the English and Chinese notes', () => {
  const note = parseNote(
    '<!-- area: tasks -->\n<!-- en -->\nAdd tasks.\n\n<!-- zh -->\n新增待办。\n',
    'minor',
  )
  assert.deepEqual(note, { kind: 'new', area: 'tasks', en: 'Add tasks.', zh: '新增待办。' })
})

test('takes the kind from its marker, defaulting by bump', () => {
  const body = '<!-- improved -->\n<!-- area: sem -->\n<!-- en -->\nFaster.\n<!-- zh -->\n更快。'
  assert.equal(parseNote(body, 'patch').kind, 'improved')
  assert.equal(parseNote(`${AREA}<!-- en -->\nA.\n<!-- zh -->\n甲。`, 'patch').kind, 'fixed')
  assert.equal(parseNote(`${AREA}<!-- zh -->\n甲。\n<!-- en -->\nA.`, 'major').en, 'A.')
})

test('rejects a missing section', () => {
  assert.match(parseNote(`${AREA}<!-- en -->\nOnly English.`, 'minor'), /needs both/)
  assert.match(parseNote(`${AREA}Plain text.`, 'minor'), /needs both/)
})

test('rejects an unknown area and leaves a missing one to the check', () => {
  const body = '<!-- en -->\nA.\n<!-- zh -->\n甲。'
  assert.match(parseNote(`<!-- area: nope -->\n${body}`, 'patch'), /unknown area "nope"/)
  assert.equal(parseNote(body, 'patch').area, undefined)
})

test('dates releases in the given time zone', () => {
  const evening = new Date('2026-10-23T01:30:00Z')
  assert.equal(today('UTC', evening), '2026-10-23')
  assert.equal(today('America/Toronto', evening), '2026-10-22')
})
