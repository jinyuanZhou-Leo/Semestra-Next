import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { expect, test } from 'vitest'
import { formatHotkey, useHotkey } from './hotkeys'

function Probe() {
  const [hits, setHits] = useState<string[]>([])
  useHotkey('?', () => setHits((h) => [...h, 'help']), { useKey: true })
  useHotkey('e', () => setHits((h) => [...h, 'edit']))
  useHotkey('mod+k', () => setHits((h) => [...h, 'palette']), { allowInInputs: true })
  return (
    <>
      <input aria-label="field" />
      <output>{hits.join(',')}</output>
    </>
  )
}

test('single keys skip text fields; modifier combos and ? work', () => {
  render(<Probe />)
  fireEvent.keyDown(document.body, { key: '?', code: 'Slash', shiftKey: true })
  fireEvent.keyDown(document.body, { key: 'e', code: 'KeyE' })
  const field = screen.getByRole('textbox', { name: 'field' })
  fireEvent.keyDown(field, { key: 'e', code: 'KeyE' })
  fireEvent.keyDown(field, { key: 'k', code: 'KeyK', ctrlKey: true })
  expect(screen.getByRole('status')).toHaveTextContent('help,edit,palette')
})

test('formats combos for people', () => {
  expect(formatHotkey('g>t')).toBe('G T')
  expect(formatHotkey('mod+up, mod+down')).toMatch(/^(⌘↑ \/ ⌘↓|Ctrl\+↑ \/ Ctrl\+↓)$/)
})
