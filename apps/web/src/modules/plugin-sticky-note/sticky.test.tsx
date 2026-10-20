import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { API, renderWithQuery, server } from '@/test-utils'
import StickyNoteCard from './StickyNoteCard'
import { stickySettingsSchema } from './schema'

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => {
  server.resetHandlers()
  saved.length = 0
})
afterAll(() => server.close())

const saved: unknown[] = []
beforeEach(() =>
  server.use(
    http.put(`${API}/layouts/cards/:id/settings`, async ({ request }) => {
      const body = (await request.json()) as { settings: unknown }
      saved.push(body.settings)
      return HttpResponse.json({
        instance_id: 'n1',
        card_id: 'sticky.note',
        settings: body.settings,
      })
    }),
  ),
)

const scope = { kind: 'course', programId: 'p1', courseId: 'c1' } as const

function note(content = '', size: 's' | 'm' | 'l' | 'xl' = 'm') {
  return renderWithQuery(
    <StickyNoteCard
      scope={scope}
      instanceId="n1"
      size={size}
      settings={stickySettingsSchema.parse({ content })}
    />,
  )
}

test('an empty note invites writing, and a click opens the editor', async () => {
  note()
  expect(screen.getByText('Write a note…')).toBeInTheDocument()
  await userEvent.click(screen.getByText('Write a note…'))
  const area = screen.getByRole('textbox', { name: 'Edit note' })
  expect(area).toHaveFocus()
  await userEvent.type(area, 'midterm covers ch. 1-4')
  expect(area).toHaveValue('midterm covers ch. 1-4')
})

test('a note is shown as formatted text, with checkboxes you can tick', async () => {
  note('**Exam** on Friday\n- [ ] review notes')
  expect(screen.getByText('Exam').tagName).toBe('STRONG')
  const box = screen.getByRole('checkbox', { name: 'Done: review notes' })
  expect(box).not.toBeChecked()
  await userEvent.click(box)
  // Ticking is a change of the note, not the start of editing.
  expect(screen.queryByRole('textbox')).toBeNull()
  expect(screen.getByRole('checkbox', { name: 'Done: review notes' })).toBeChecked()
})

test('the toolbar formats the selected text and keeps editing', async () => {
  note('plain', 'l')
  await userEvent.click(screen.getByText('plain'))
  const area = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Edit note' })
  area.setSelectionRange(0, 5)
  await userEvent.click(screen.getByRole('button', { name: 'Bold' }))
  expect(area).toHaveValue('**plain**')
  expect(screen.getByRole('textbox')).toBeInTheDocument()
})

test('the small size hides the toolbar', async () => {
  note('x', 's')
  await userEvent.click(screen.getByText('x'))
  expect(screen.queryByRole('button', { name: 'Bold' })).toBeNull()
})

test('the editor leaves a way in for keyboard users', () => {
  note('x')
  expect(screen.getByRole('button', { name: 'Edit note' })).toBeInTheDocument()
})

test('an edit is saved to the card settings, merged into the settings the host gave', async () => {
  note('old')
  await userEvent.click(screen.getByText('old'))
  await userEvent.type(screen.getByRole('textbox', { name: 'Edit note' }), ' new')
  await vi.waitFor(() => expect(saved.length).toBeGreaterThan(0), { timeout: 3000 })
  expect(saved.at(-1)).toMatchObject({ content: 'old new', color: expect.any(String) })
})
