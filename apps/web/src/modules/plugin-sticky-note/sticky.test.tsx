import { screen, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
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

test('a Markdown table typed into the note becomes a table', async () => {
  note('', 'l')
  await userEvent.click(await screen.findByRole('textbox', { name: 'Edit note' }))
  await userEvent.keyboard('| Chapter | Status |{Enter}| --- | --- |{Enter}1')
  expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
    'Chapter',
    'Status',
  ])
  expect(screen.getAllByRole('cell')[0]).toHaveTextContent('1')
  await waitForSave()
  expect(savedContent()).toContain('| Chapter | Status |')
})

test('pasted Markdown is formatted', async () => {
  note('', 'l')
  await userEvent.click(await screen.findByRole('textbox', { name: 'Edit note' }))
  await userEvent.paste('| A | B |\n| --- | --- |\n| 1 | 2 |')
  expect(screen.getByRole('table')).toBeInTheDocument()
  expect(screen.getByRole('cell', { name: '2' })).toBeInTheDocument()
})

test('a change made elsewhere shows while the note is being edited', async () => {
  const { rerender, queryClient } = note('old')
  const editor = await screen.findByRole('textbox', { name: 'Edit note' })
  await userEvent.click(editor)
  rerender(
    <QueryClientProvider client={queryClient}>
      <StickyNoteCard
        scope={scope}
        instanceId="n1"
        size="m"
        settings={stickySettingsSchema.parse({ content: 'old\n\nfrom Sem' })}
      />
    </QueryClientProvider>,
  )
  expect(await screen.findByText('from Sem')).toBeInTheDocument()
  expect(editor).toHaveFocus()
  await userEvent.keyboard('!')
  await vi.waitFor(() => expect(savedContent()).toMatch(/from Sem/), { timeout: 3000 })
})

test('with nothing selected, a link is added as its address', async () => {
  note('', 'l')
  await userEvent.click(await screen.findByRole('textbox', { name: 'Edit note' }))
  await userEvent.click(screen.getByRole('button', { name: 'Link' }))
  await userEvent.type(await screen.findByRole('textbox', { name: 'Link address' }), 'example.com')
  await userEvent.click(screen.getByRole('button', { name: 'Add link' }))
  expect(screen.getByRole('link', { name: 'example.com' })).toHaveAttribute(
    'href',
    'https://example.com',
  )
  await vi.waitFor(() => expect(savedContent()).toBe('[example.com](https://example.com)'), {
    timeout: 3000,
  })
})

test('a note at its length limit refuses more text but can still be shortened', async () => {
  note('x'.repeat(10_000))
  const editor = await screen.findByRole('textbox', { name: 'Edit note' })
  await userEvent.click(editor)
  await userEvent.keyboard('y')
  expect(editor.textContent).not.toContain('y')
  await userEvent.keyboard('{Control>}a{/Control}z')
  await vi.waitFor(() => expect(savedContent()).toBe('z'), { timeout: 3000 })
})
