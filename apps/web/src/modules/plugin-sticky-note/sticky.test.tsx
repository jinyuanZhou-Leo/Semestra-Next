import { screen, within } from '@testing-library/react'
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

const savedContent = () => (saved.at(-1) as { content: string }).content

async function waitForSave() {
  await vi.waitFor(() => expect(saved.length).toBeGreaterThan(0), { timeout: 3000 })
}

test('a note shows its Markdown formatted, tables included', async () => {
  note('**Exam** on Friday\n\n| Chapter | Status |\n| --- | --- |\n| 1 | done |')
  expect(await screen.findByText('Exam')).toHaveProperty('tagName', 'STRONG')
  const table = screen.getByRole('table')
  expect(within(table).getByText('Chapter').closest('th')).not.toBeNull()
  expect(within(table).getByText('done').closest('td')).not.toBeNull()
})

test('ticking a checklist item saves the note', async () => {
  note('- [ ] review notes')
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Done: review notes' }))
  await waitForSave()
  expect(savedContent()).toBe('- [x] review notes')
})

test('an edit is saved as Markdown, merged into the settings the host gave', async () => {
  note('old')
  const editor = await screen.findByRole('textbox', { name: 'Edit note' })
  await userEvent.click(editor)
  await userEvent.keyboard('{Control>}a{/Control}{Control>}b{/Control}')
  await waitForSave()
  expect(saved.at(-1)).toMatchObject({ content: '**old**', color: expect.any(String) })
})

test('the toolbar inserts a table, and offers row and column actions inside it', async () => {
  note('', 'l')
  await userEvent.click(await screen.findByRole('textbox', { name: 'Edit note' }))
  await userEvent.click(screen.getByRole('button', { name: 'Insert table' }))
  expect(screen.getByRole('table')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Table' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Add column right' }))
  expect(screen.getAllByRole('columnheader')).toHaveLength(4)
  await waitForSave()
  expect(savedContent()).toMatch(/^\|.*\|.*\|.*\|.*\|$/m)
})

test('the small size has no toolbar', async () => {
  note('x', 's')
  await userEvent.click(await screen.findByRole('textbox', { name: 'Edit note' }))
  expect(screen.queryByRole('button', { name: 'Bold' })).toBeNull()
})
