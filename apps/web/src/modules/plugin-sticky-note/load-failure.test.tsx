import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll, expect, test, vi } from 'vitest'
import { renderWithQuery, server } from '@/test-utils'
import StickyHeaderActions from './StickyHeaderActions'
import StickyNoteCard from './StickyNoteCard'
import { stickySettingsSchema } from './schema'

// The editor's code cannot be fetched (offline, or a deploy removed the old chunk).
vi.mock('./NoteEditor', () => {
  throw new Error('Failed to fetch dynamically imported module')
})
const error = vi.hoisted(() => vi.fn<(message: string, options?: object) => void>())
vi.mock('sonner', () => ({ toast: { error } }))

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterAll(() => server.close())

test('a note whose editor cannot load says so and stays as it reads', async () => {
  const props = {
    scope: { kind: 'course', programId: 'p1', courseId: 'c1' } as const,
    instanceId: 'n1',
    size: 'm' as const,
    settings: stickySettingsSchema.parse({ content: 'hello' }),
  }
  renderWithQuery(
    <section data-card="sticky.note">
      <StickyHeaderActions {...props} />
      <StickyNoteCard {...props} />
    </section>,
  )
  await userEvent.click(await screen.findByRole('button', { name: 'Edit note' }))
  await waitFor(() =>
    expect(error).toHaveBeenCalledWith("Couldn't open the editor. Try again.", expect.anything()),
  )
  expect(screen.getByRole('button', { name: 'Edit note' })).toBeInTheDocument()
  expect(screen.getByLabelText('Sticky note')).toHaveAttribute('contenteditable', 'false')
  expect(screen.getByText('hello')).toBeInTheDocument()
})
