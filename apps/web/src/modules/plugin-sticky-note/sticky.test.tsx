import { screen, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { API, renderWithQuery, server } from '@/test-utils'
import StickyHeaderActions from './StickyHeaderActions'
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

function Card({ content, size = 'm' }: { content: string; size?: 's' | 'm' | 'l' | 'xl' }) {
  const props = {
    scope,
    instanceId: 'n1',
    size,
    settings: stickySettingsSchema.parse({ content }),
  }
  return (
    <section data-card="sticky.note">
      <StickyHeaderActions {...props} />
      <StickyNoteCard {...props} />
    </section>
  )
}

function note(content = '', size: 's' | 'm' | 'l' | 'xl' = 'm') {
  const view = renderWithQuery(<Card content={content} size={size} />)
  return {
    ...view,
    rerender: (next: string) =>
      view.rerender(
        <QueryClientProvider client={view.queryClient}>
          <Card content={next} size={size} />
        </QueryClientProvider>,
      ),
  }
}

/** Starts editing with the header's button, returning the editor. */
async function edit() {
  await userEvent.click(await screen.findByRole('button', { name: 'Edit note' }))
  const editor = screen.getByLabelText('Sticky note')
  expect(editor).toHaveAttribute('contenteditable', 'true')
  await vi.waitFor(() => expect(editor).toHaveFocus())
  return editor
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

test('a note is read-only, with working links, until editing starts', async () => {
  note('See [syllabus](https://example.com/s)')
  const editor = await screen.findByLabelText('Sticky note')
  expect(editor).toHaveAttribute('contenteditable', 'false')
  expect(screen.getByRole('link', { name: 'syllabus' })).toHaveAttribute(
    'href',
    'https://example.com/s',
  )
  const bold = screen.getByRole('button', { name: 'Bold' })
  expect(bold.closest('[inert]')).not.toBeNull()

  await edit()
  expect(bold.closest('[inert]')).toBeNull()
  await userEvent.keyboard('{Escape}')
  expect(editor).toHaveAttribute('contenteditable', 'false')
  expect(screen.getByRole('button', { name: 'Edit note' })).toBeInTheDocument()
})

test('clicking outside the card ends editing', async () => {
  note('old')
  const editor = await edit()
  await userEvent.click(document.body)
  expect(editor).toHaveAttribute('contenteditable', 'false')
})

test('an empty note starts editing when clicked', async () => {
  note('')
  await userEvent.click(await screen.findByText('', { selector: '.sticky-note p' }))
  expect(screen.getByLabelText('Sticky note')).toHaveAttribute('contenteditable', 'true')
})

test('ticking a checklist item saves the note', async () => {
  note('- [ ] review notes')
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Done: review notes' }))
  await waitForSave()
  expect(savedContent()).toBe('- [x] review notes')
})

test('an edit is saved as Markdown, merged into the settings the host gave', async () => {
  note('old')
  await edit()
  await userEvent.keyboard('{Control>}a{/Control}{Control>}b{/Control}')
  await waitForSave()
  expect(saved.at(-1)).toMatchObject({ content: '**old**', color: expect.any(String) })
})

test('the toolbar inserts a table, and offers row and column actions inside it', async () => {
  note('', 'l')
  await edit()
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
  await edit()
  expect(screen.queryByRole('button', { name: 'Bold' })).toBeNull()
})

test('a Markdown table typed into the note becomes a table', async () => {
  note('', 'l')
  await edit()
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
  await edit()
  await userEvent.paste('| A | B |\n| --- | --- |\n| 1 | 2 |')
  expect(screen.getByRole('table')).toBeInTheDocument()
  expect(screen.getByRole('cell', { name: '2' })).toBeInTheDocument()
})

test('a change made elsewhere shows while the note is being edited', async () => {
  const { rerender } = note('old')
  const editor = await edit()
  rerender('old\n\nfrom Sem')
  expect(await screen.findByText('from Sem')).toBeInTheDocument()
  expect(editor).toHaveFocus()
  await userEvent.keyboard('!')
  await vi.waitFor(() => expect(savedContent()).toMatch(/from Sem/), { timeout: 3000 })
})

test('undo does not take back a change made elsewhere', async () => {
  const { rerender } = note('old')
  await edit()
  await userEvent.keyboard('!')
  await vi.waitFor(() => expect(savedContent()).toMatch(/!/), { timeout: 3000 })
  const typed = savedContent()
  saved.length = 0
  rerender(`${typed}\n\nfrom Sem`)
  expect(await screen.findByText('from Sem')).toBeInTheDocument()
  await userEvent.keyboard('{Control>}z{/Control}')
  expect(screen.getByText('from Sem')).toBeInTheDocument()
  await new Promise((resolve) => setTimeout(resolve, 1000))
  expect(saved).toEqual([])
})

test('with nothing selected, a link is added as its address', async () => {
  note('', 'l')
  await edit()
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
  const editor = await edit()
  await userEvent.keyboard('y')
  expect(editor.textContent).not.toContain('y')
  await userEvent.keyboard('{Control>}a{/Control}z')
  await vi.waitFor(() => expect(savedContent()).toBe('z'), { timeout: 3000 })
})
