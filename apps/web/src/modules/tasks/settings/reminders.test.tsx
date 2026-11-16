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

const waiting = {
  id: 'c1',
  program_id: 'p1',
  client: null,
  last_seen_at: null,
  created_at: '2026-11-16T12:00:00Z',
}
const iphone = { ...waiting, id: 'c2', client: 'ios', last_seen_at: '2026-11-16T12:05:00Z' }

function created(id: string, password: string) {
  return {
    ...waiting,
    id,
    password,
    setup: {
      url: `https://semestra.example/caldav-setup/${password}.mobileconfig`,
      expires_at: '2099-01-01T00:00:00Z',
    },
  }
}

function mount({
  available = true,
  items = [] as Record<string, unknown>[],
  taskNotifications = true,
} = {}) {
  const state = { items: [...items], listed: 0, settings: [] as unknown[] }
  const settings = () =>
    HttpResponse.json({
      namespace: 'notifications',
      scope_type: 'account',
      scope_id: null,
      values: { task_reminder: 'off' },
      sources: {},
    })
  server.use(
    http.post(`${API}/me/ui-state\\:get`, () => HttpResponse.json({ items: {} })),
    http.put(`${API}/me/ui-state/:key`, () => HttpResponse.json({ ok: true })),
    http.patch(`${API}/me/settings/notifications`, async ({ request }) => {
      state.settings.push(((await request.json()) as { values: unknown }).values)
      return settings()
    }),
    http.get(`${API}/programs/p1/caldav-connections`, () => {
      state.listed += 1
      return HttpResponse.json({
        available,
        server_url: 'https://semestra.example/caldav/',
        username: 'student@example.com',
        items: state.items,
        task_notifications: taskNotifications,
      })
    }),
    http.post(`${API}/programs/p1/caldav-connections`, () => {
      state.items.push(waiting)
      return HttpResponse.json(created('c1', 'first-password'))
    }),
    http.post(`${API}/caldav-connections/c2\\:reset`, () =>
      HttpResponse.json(created('c2', 'new-password')),
    ),
  )
  renderWithRouter(
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
  return state
}

test('connecting a device shows how to set it up, with its password', async () => {
  mount()
  await userEvent.click(await screen.findByRole('button', { name: 'Connect a device' }))
  const dialog = await screen.findByRole('dialog', { name: 'Connect Apple Reminders' })
  expect(within(dialog).getByTitle('Setup QR code')).toBeInTheDocument()
  expect(within(dialog).getByText('Download profile').closest('a')).toHaveAttribute(
    'href',
    'https://semestra.example/caldav-setup/first-password.mobileconfig',
  )
  await userEvent.click(within(dialog).getByRole('button', { name: 'Set up manually' }))
  expect(within(dialog).getByRole('textbox', { name: 'Password' })).toHaveValue('first-password')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }))
  expect(await screen.findByText('Not connected yet')).toBeInTheDocument()
  // Nothing has synced yet, so there is nothing to ask about notifications.
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
})

test('setting a device up again gives it a new password', async () => {
  mount({ items: [iphone], taskNotifications: false })
  await userEvent.click(await screen.findByRole('button', { name: 'Actions for iPhone or iPad' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Set up again' }))
  const confirm = await screen.findByRole('alertdialog', { name: 'Set up this device again?' })
  await userEvent.click(within(confirm).getByRole('button', { name: 'Set up again' }))
  const dialog = await screen.findByRole('dialog', { name: 'Connect Apple Reminders' })
  await userEvent.click(within(dialog).getByRole('button', { name: 'Set up manually' }))
  expect(within(dialog).getByRole('textbox', { name: 'Password' })).toHaveValue('new-password')
})

test('once a device syncs, offers to turn off Semestra task notifications', async () => {
  const state = mount({ items: [iphone] })
  const question = await screen.findByRole('alertdialog', {
    name: 'Turn off Semestra task notifications?',
  })
  await userEvent.click(within(question).getByRole('button', { name: 'Turn off' }))
  await expect.poll(() => state.settings).toEqual([{ task_reminder: 'off' }])
})

test('the section is left out when the server does not offer it', async () => {
  const state = mount({ available: false })
  await expect.poll(() => state.listed).toBe(1)
  expect(screen.queryByRole('button', { name: 'Connect a device' })).not.toBeInTheDocument()
  expect(screen.queryByText('No connected devices')).not.toBeInTheDocument()
})
