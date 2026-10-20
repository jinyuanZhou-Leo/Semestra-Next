import { Blob as NodeBlob, File as NodeFile } from 'node:buffer'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest'
import { ModuleRegistry } from '@/app/registry'
import { SettingsSections } from '@/app/settings'
import { AuthContext, type AuthState } from '@/modules/auth/useAuth'
import { API, apiError, renderWithRouter, server, user } from '@/test-utils'
import manifest from './manifest'

beforeAll(async () => {
  server.listen({ onUnhandledFrame: 'error' })
  // fetch is Node's (undici), which cannot send jsdom's FormData, Blob and File on Node 26;
  // these tests use Node's own, as a browser would use its own.
  const nativeFormData = (
    await new Response('a=1', {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    }).formData()
  ).constructor
  vi.stubGlobal('FormData', nativeFormData)
  vi.stubGlobal('Blob', NodeBlob)
  vi.stubGlobal('File', NodeFile)
})
afterEach(() => server.resetHandlers())
afterAll(() => {
  server.close()
  vi.unstubAllGlobals()
})

const job = (over: Record<string, unknown> = {}) => ({
  id: 'j1',
  kind: 'portability.export',
  status: 'running',
  progress: 10,
  step: 'collecting',
  step_current: null,
  step_total: null,
  result: null,
  error_code: null,
  error_params: null,
  attempts: 1,
  max_attempts: 3,
  cancel_requested: false,
  created_at: '2026-01-15T12:00:00Z',
  started_at: null,
  finished_at: null,
  ...over,
})

const exportRow = (over: Record<string, unknown> = {}) => ({
  id: 'e1',
  status: 'ready',
  include_files: false,
  size_bytes: 2048,
  job_id: 'j1',
  created_at: '2026-01-15T12:00:00Z',
  expires_at: '2026-01-16T12:00:00Z',
  ...over,
})

const preview = {
  exported_at: '2026-01-10T08:00:00Z',
  app_version: '0.1.0',
  include_files: false,
  files_bytes: 0,
  counts: { academics: { programs: 2, terms: 3, courses: 5, course_terms: 5 } },
  programs: [
    { id: 'p1', name: 'Engineering', term_count: 2, course_count: 4 },
    { id: 'p2', name: 'Minor', term_count: 1, course_count: 1 },
  ],
  quota_exceeded: false,
  unknown_modules: [],
}

const upload = (over: Record<string, unknown> = {}) => ({
  id: 'i1',
  status: 'uploaded',
  size_bytes: 1000,
  preview,
  report: null,
  error_code: null,
  job_id: null,
  created_at: '2026-01-15T12:00:00Z',
  expires_at: '2026-01-16T12:00:00Z',
  ...over,
})

function mount(group: 'data' = 'data', signOut: AuthState['signOut'] = async () => {}) {
  server.use(
    http.post(`${API}/me/ui-state\\:get`, () => HttpResponse.json({ items: {} })),
    http.put(`${API}/me/ui-state/:key`, () => HttpResponse.json({})),
    http.get(`${API}/storage/usage`, () =>
      HttpResponse.json({ used_bytes: 0, quota_bytes: 0, by_module: {} }),
    ),
  )
  return renderWithRouter(
    <AuthContext.Provider value={{ user, isLoading: false, signOut }}>
      <ModuleRegistry value={[manifest]}>
        <SettingsSections level="account" group={group} />
      </ModuleRegistry>
    </AuthContext.Provider>,
  )
}

test('starts an export and offers the finished file for download', async () => {
  let exports: unknown[] = []
  const started = vi.fn<(body: unknown) => void>()
  server.use(
    http.get(`${API}/me/exports`, () => HttpResponse.json({ items: exports })),
    http.post(`${API}/me/exports`, async ({ request }) => {
      started(await request.json())
      exports = [exportRow()]
      return HttpResponse.json(exportRow({ status: 'pending' }))
    }),
    http.get(`${API}/me/imports/:id`, () => HttpResponse.json(upload())),
    http.get(`${API}/jobs/:id`, () => HttpResponse.json(job({ status: 'succeeded' }))),
  )
  mount()

  const files = await screen.findByRole('switch', { name: 'Include files' })
  expect(files).toHaveAttribute('data-disabled')
  await userEvent.click(screen.getByRole('button', { name: 'Export' }))
  expect(started).toHaveBeenCalledWith({ include_files: false })
  const download = await screen.findByRole('button', { name: 'Download' })
  expect(download).toHaveAttribute('href', `${API}/me/exports/e1/download`)
})

test('previews an uploaded backup and asks for the sentence before replacing', async () => {
  const startBodies: unknown[] = []
  server.use(
    http.get(`${API}/me/exports`, () => HttpResponse.json({ items: [] })),
    http.post(`${API}/me/imports`, () => HttpResponse.json(upload())),
    http.get(`${API}/me/imports/:id`, () => HttpResponse.json(upload())),
    http.post(`${API}/me/imports/:id\\:start`, async ({ request }) => {
      startBodies.push(await request.json())
      return HttpResponse.json(upload({ status: 'importing', job_id: 'j2' }))
    }),
    http.get(`${API}/jobs/:id`, () =>
      HttpResponse.json(job({ id: 'j2', kind: 'portability.import', step: 'importing' })),
    ),
  )
  mount()

  const input = await screen.findByLabelText('Choose file', { selector: 'input' })
  await userEvent.upload(input, new File(['zip'], 'backup.zip', { type: 'application/zip' }))

  expect(await screen.findByText('Engineering')).toBeInTheDocument()
  expect(screen.getByText('2 terms · 4 courses')).toBeInTheDocument()
  // Entities without a label (course_terms) are not listed.
  expect(screen.getByText('Courses')).toBeInTheDocument()
  expect(screen.queryByText('course_terms')).not.toBeInTheDocument()

  await userEvent.click(screen.getByRole('checkbox', { name: 'Minor' }))
  await userEvent.click(screen.getByRole('button', { name: 'Replace' }))
  await userEvent.click(screen.getByRole('button', { name: 'Import' }))

  const dialog = await screen.findByRole('alertdialog')
  const confirm = within(dialog).getByRole('button', { name: 'Replace' })
  expect(confirm).toBeDisabled()
  await userEvent.type(within(dialog).getByRole('textbox'), 'replace my data')
  await userEvent.click(confirm)

  await waitFor(() => expect(startBodies).toHaveLength(1))
  expect(startBodies[0]).toEqual({
    mode: 'replace',
    program_ids: ['p1'],
    include_preferences: false,
    confirmation: 'replace my data',
  })
})

test('shows why a backup was refused', async () => {
  server.use(
    http.get(`${API}/me/exports`, () => HttpResponse.json({ items: [] })),
    http.post(`${API}/me/imports`, () => {
      const { status, body } = apiError('portability.legacy_backup', 400)
      return HttpResponse.json(body, { status })
    }),
  )
  mount()
  const input = await screen.findByLabelText('Choose file', { selector: 'input' })
  await userEvent.upload(input, new File(['{}'], 'old.json', { type: 'application/json' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('backup from the old Semestra')
})

test('deletes the account after the sentence and the tick, then leaves', async () => {
  const signOut = vi.fn<AuthState['signOut']>(async () => {})
  let attempts = 0
  const bodies: unknown[] = []
  server.use(
    http.get(`${API}/me/exports`, () => HttpResponse.json({ items: [] })),
    http.post(`${API}/me\\:delete`, async ({ request }) => {
      bodies.push(await request.json())
      attempts += 1
      if (attempts === 1) {
        const { status, body } = apiError('auth.reauth_required', 403, { password: true })
        return HttpResponse.json(body, { status })
      }
      return HttpResponse.json(job({ kind: 'portability.account_delete' }))
    }),
  )
  mount('data', signOut)

  await userEvent.click(await screen.findByRole('button', { name: 'Delete account' }))
  const dialog = await screen.findByRole('alertdialog')
  const confirm = within(dialog).getByRole('button', { name: 'Delete account' })
  await userEvent.type(within(dialog).getByRole('textbox'), 'delete my account')
  expect(confirm).toBeDisabled()
  await userEvent.click(within(dialog).getByRole('checkbox'))
  await userEvent.click(confirm)

  // The last sign-in is too old: the password is asked for.
  const password = await within(dialog).findByLabelText('Password')
  await userEvent.type(password, 'secret')
  await userEvent.click(confirm)

  await waitFor(() =>
    expect(signOut).toHaveBeenCalledWith({ to: '/account-deleted', flush: false }),
  )
  expect(bodies[1]).toEqual({
    confirmation: 'delete my account',
    acknowledged: true,
    password: 'secret',
  })
})
