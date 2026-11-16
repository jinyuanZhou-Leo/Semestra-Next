import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest'
import { SectionFrame } from '@/app/settings/SettingsSections'
import { API, renderWithRouter, server } from '@/test-utils'
import RemindersSection from './RemindersSection'

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const device = {
  id: 'c1',
  program_id: 'p1',
  client: null,
  last_seen_at: null,
  created_at: '2026-11-16T12:00:00Z',
  password: 'secret-password',
}

function mount(available: boolean, items: (typeof device)[] = []) {
  const state = { items: [...items] }
  const notifications = { task_reminder: '60' as string }
  const pushChanges: unknown[] = []
  server.use(
    http.post(`${API}/me/ui-state\\:get`, () => HttpResponse.json({ items: {} })),
    http.put(`${API}/me/ui-state/:key`, () => HttpResponse.json({ ok: true })),
    http.get(`${API}/me/settings/notifications`, () =>
      HttpResponse.json({
        namespace: 'notifications',
        scope_type: 'account',
        scope_id: null,
        values: notifications,
        sources: {},
      }),
    ),
    http.patch(`${API}/me/settings/notifications`, async ({ request }) => {
      const body = (await request.json()) as { values: Record<string, string> }
      pushChanges.push(body.values)
      Object.assign(notifications, body.values)
      return HttpResponse.json({
        namespace: 'notifications',
        scope_type: 'account',
        scope_id: null,
        values: notifications,
        sources: {},
      })
    }),
    http.get(`${API}/programs/p1/caldav-connections`, () =>
      HttpResponse.json({
        available,
        server_url: 'https://semestra.example/caldav/',
        username: 'student@example.com',
        items: state.items,
      }),
    ),
    http.post(`${API}/programs/p1/caldav-connections`, () => {
      state.items.push(device)
      return HttpResponse.json(device)
    }),
    http.post(`${API}/caldav-connections/c1/setup-link`, () =>
      HttpResponse.json({
        url: 'https://semestra.example/caldav-setup/code.mobileconfig',
        expires_at: '2026-11-16T12:15:00Z',
      }),
    ),
  )
  const view = renderWithRouter(
    <SectionFrame
      section={{
        id: 'tasks-reminders',
        level: 'program',
        order: 0,
        title: () => 'Apple Reminders',
        component: RemindersSection,
      }}
      scope={{ kind: 'program', programId: 'p1' }}
    />,
  )
  return { ...view, pushChanges }
}

test('connecting a device shows how to set it up, with its password', async () => {
  mount(true)
  await userEvent.click(await screen.findByRole('button', { name: 'Connect a device' }))
  const dialog = await screen.findByRole('dialog', { name: 'Connect Apple Reminders' })
  expect(await within(dialog).findByTitle('QR code to set up a device')).toBeInTheDocument()
  expect(within(dialog).getByText('Download profile').closest('a')).toHaveAttribute(
    'href',
    'https://semestra.example/caldav-setup/code.mobileconfig',
  )
  await userEvent.click(within(dialog).getByRole('button', { name: 'Set up manually' }))
  expect(within(dialog).getByRole('textbox', { name: 'Password' })).toHaveValue('secret-password')
  expect(await screen.findByText('Waiting to connect')).toBeInTheDocument()
})

test('the section is left out when the server does not offer it', async () => {
  const { container } = mount(false)
  // The section hides itself when its content is empty (`has-[>div:empty]:hidden`).
  const content = () => container.querySelector('section > div.space-y-6')
  await expect.poll(() => content()?.childElementCount).toBe(0)
})

test("after setting up a device, offers once to turn off Semestra's own to-do reminders", async () => {
  const { pushChanges } = mount(true)
  await userEvent.click(await screen.findByRole('button', { name: 'Connect a device' }))
  const dialog = await screen.findByRole('dialog', { name: 'Connect Apple Reminders' })
  await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }))
  const question = await screen.findByRole('alertdialog', {
    name: "Turn off Semestra's task reminders?",
  })
  await userEvent.click(within(question).getByRole('button', { name: 'Turn off' }))
  await expect.poll(() => pushChanges).toEqual([{ task_reminder: 'off' }])
})
