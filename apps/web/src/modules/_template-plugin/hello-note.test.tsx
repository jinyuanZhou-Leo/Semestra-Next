import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'
import { API, server } from '@/test-utils'
import { renderWithQuery } from '@/test-utils'
import HelloNoteCard from './HelloNoteCard'
import { helloNoteCardSchema } from './schema'

const scope = { kind: 'course', courseId: 'c1', termId: 't1', programId: 'p1' } as const

function card(settings: Record<string, unknown>, size: 's' | 'm' | 'l' = 'm') {
  return renderWithQuery(
    <HelloNoteCard
      scope={scope}
      instanceId="i1"
      size={size}
      settings={helloNoteCardSchema.parse(settings)}
    />,
  )
}

test('a card created before a field existed still parses', () => {
  expect(helloNoteCardSchema.parse({})).toEqual({ title: '', text: '' })
})

test('every declared size has a design', () => {
  const small = card({ text: 'first\nsecond' }, 's')
  expect(screen.getByText('first')).toBeInTheDocument()
  expect(screen.queryByRole('textbox')).toBeNull()
  small.unmount()
  card({ text: 'first\nsecond' }, 'l')
  expect(screen.getByRole('textbox')).toHaveValue('first\nsecond')
})

test('typing updates the note at once and the line count follows the plugin setting', async () => {
  server.use(
    http.get(`${API}/me/settings/plugin.hello-note`, () =>
      HttpResponse.json({ values: { show_count: true } }),
    ),
  )
  card({ text: '' })
  await userEvent.type(screen.getByRole('textbox'), 'a{Enter}b')
  expect(screen.getByRole('textbox')).toHaveValue('a\nb')
  expect(await screen.findByText('2 lines')).toBeInTheDocument()
})

test('two cards do not share their text', () => {
  render(<div />)
  card({ text: 'one' }, 'l')
  card({ text: 'two' }, 'l')
  expect(screen.getAllByRole('textbox').map((box) => (box as HTMLTextAreaElement).value)).toEqual([
    'one',
    'two',
  ])
})
