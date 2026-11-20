import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest'
import { API, renderWithQuery, server } from '@/test-utils'
import StickyNoteCard from './StickyNoteCard'
import { stickySettingsSchema } from './schema'

// The editor's code arrives a moment after the clicks (no hover beforehand, a slow network).
vi.mock('./NoteEditor', async (importOriginal) => {
  await new Promise((resolve) => setTimeout(resolve, 300))
  return importOriginal()
})

const saved: string[] = []
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

test('items ticked while the editor loads are all saved', async () => {
  server.use(
    http.put(`${API}/layouts/cards/:id/settings`, async ({ request }) => {
      const body = (await request.json()) as { settings: { content: string } }
      saved.push(body.settings.content)
      return HttpResponse.json({
        instance_id: 'n1',
        card_id: 'sticky.note',
        settings: body.settings,
      })
    }),
  )
  renderWithQuery(
    <section data-card="sticky.note">
      <StickyNoteCard
        scope={{ kind: 'course', programId: 'p1', courseId: 'c1' }}
        instanceId="n1"
        size="m"
        settings={stickySettingsSchema.parse({ content: '- [ ] one\n- [ ] two' })}
      />
    </section>,
  )
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Done: one' }))
  await userEvent.click(screen.getByRole('checkbox', { name: 'Done: two' }))
  expect(screen.getByRole('checkbox', { name: 'Done: one' })).toBeChecked()
  expect(screen.getByRole('checkbox', { name: 'Done: two' })).toBeChecked()
  await vi.waitFor(() => expect(saved.at(-1)).toBe('- [x] one\n- [x] two'), { timeout: 3000 })
})

test('a tick is not written when the editor reads a different item there', async () => {
  const { toggleTask } = await import('./NoteEditor')
  expect(toggleTask('- [ ] a\n- [ ] b', 1, true, 'b')).toBe('- [ ] a\n- [x] b')
  expect(() => toggleTask('- [ ] a\n- [ ] b', 1, true, 'a')).toThrow('Checklist item 1 is not "a"')
})
