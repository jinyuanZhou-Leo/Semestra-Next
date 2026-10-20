import type { AgentSessionOut } from '@semestra/api-client'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'vitest'
import { API, renderWithRouter, server } from '@/test-utils'
import { SidebarMenu, SidebarMenuItem, SidebarProvider } from '@/ui/sidebar'
import { RECENT_SESSIONS, SessionNav } from './components/SessionNav'

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const NOW = '2026-10-19T12:00:00Z'

function session(index: number, overrides: Partial<AgentSessionOut> = {}): AgentSessionOut {
  return {
    id: `s${index}`,
    title: `Chat ${index}`,
    program_id: 'p1',
    scope: { program_id: 'p1', term_id: null, course_id: null },
    pinned: false,
    created_at: NOW,
    updated_at: NOW,
    archived_at: null,
    ...overrides,
  }
}

let items: AgentSessionOut[]
let deleted: string[]
beforeEach(() => {
  // Newest first, as the API lists them; the oldest one is pinned.
  items = Array.from({ length: 10 }, (_, i) => session(i + 1, { pinned: i === 9 }))
  deleted = []
  server.use(
    http.get(`${API}/agent/sessions`, () => HttpResponse.json({ items })),
    http.delete(`${API}/agent/sessions/:id`, ({ params }) => {
      deleted.push(String(params.id))
      items = items.filter((s) => s.id !== params.id)
      return new HttpResponse(null, { status: 204 })
    }),
  )
})

function mount() {
  return renderWithRouter(
    <SidebarProvider>
      <SidebarMenu>
        <SidebarMenuItem>
          <SessionNav programId="p1" onNavigate={() => {}} />
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarProvider>,
  )
}

test('the sidebar lists the pinned conversation first, then the recent ones, then "All"', async () => {
  mount()
  const nav = await screen.findByRole('list', { name: 'History' })
  await within(nav).findByRole('link', { name: 'Chat 10' })
  const links = within(nav).getAllByRole('link')
  expect(links).toHaveLength(RECENT_SESSIONS)
  expect(links.map((l) => l.textContent)).toEqual([
    'Chat 10',
    'Chat 1',
    'Chat 2',
    'Chat 3',
    'Chat 4',
    'Chat 5',
    'Chat 6',
    'Chat 7',
  ])
  expect(links[1]).toHaveAttribute('href', '/p/p1/assistant/s1')
  await userEvent.click(within(nav).getByRole('button', { name: 'All conversations…' }))
  const dialog = await screen.findByRole('dialog', { name: 'History' })
  expect(within(dialog).getByRole('searchbox', { name: 'Search conversations' })).toBeTruthy()
  expect(await within(dialog).findByRole('button', { name: 'Chat 9' })).toBeTruthy()
})

test('a conversation is deleted from its menu in the sidebar, after asking', async () => {
  mount()
  const nav = await screen.findByRole('list', { name: 'History' })
  await userEvent.click(await within(nav).findByRole('button', { name: 'Actions for Chat 2' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }))
  const confirm = await screen.findByRole('alertdialog')
  await userEvent.click(within(confirm).getByRole('button', { name: 'Delete' }))
  await waitFor(() => expect(deleted).toEqual(['s2']))
  await waitFor(() => expect(within(nav).queryByRole('link', { name: 'Chat 2' })).toBeNull())
})
