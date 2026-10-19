import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { Suspense } from 'react'
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest'
import { ModuleRegistry } from '@/app/registry'
import template from '@/modules/_template/manifest'
import { API, renderWithRouter, server } from '@/test-utils'
import PluginCatalog from './PluginCatalog'
import plugins from './manifest'

beforeAll(() => server.listen())
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function entry(id: string, kind: 'plugin' | 'core', installed: boolean, summary = '') {
  return {
    id,
    kind,
    name_key: `${id}_name`,
    description_key: `${id}_description`,
    summary,
    version: '1.0.0',
    author: 'Semestra',
    default_installed: false,
    installed,
    installed_at: null,
    provides: { pages: [], cards: [], capabilities: [] },
  }
}

/** A catalog whose installed state follows the install and uninstall calls it receives. */
function catalog(initial: Record<string, boolean>) {
  const installed = { ...initial }
  const calls: string[] = []
  server.use(
    http.get(`${API}/plugins/catalog`, () =>
      HttpResponse.json({
        items: [
          entry('plugins', 'core', true),
          entry('template', 'plugin', installed.template ?? false),
          entry('abacus', 'plugin', installed.abacus ?? false, 'Counts beads'),
        ],
      }),
    ),
    http.put(`${API}/plugins/:id/installation`, ({ params }) => {
      const id = String(params.id)
      installed[id] = true
      calls.push(`install ${id}`)
      return HttpResponse.json(entry(id, 'plugin', true))
    }),
    http.delete(`${API}/plugins/:id/installation`, ({ params, request }) => {
      const id = String(params.id)
      installed[id] = false
      calls.push(`uninstall ${id} purge=${new URL(request.url).searchParams.get('purge_data')}`)
      return new HttpResponse(null, { status: 204 })
    }),
  )
  return calls
}

function renderCatalog() {
  return renderWithRouter(
    <ModuleRegistry value={[plugins, template]}>
      <Suspense>
        <PluginCatalog />
      </Suspense>
    </ModuleRegistry>,
  )
}

test('the marketplace searches plugins and filters to installed ones', async () => {
  catalog({ abacus: true })
  renderCatalog()
  const grid = within((await screen.findByText('Module template')).closest('ul')!)
  expect(grid.getByRole('button', { name: 'Install' })).toBeInTheDocument()
  expect(grid.getByRole('button', { name: 'Installed (abacus), more options' })).toBeInTheDocument()
  // Core features are listed apart, without install controls.
  expect(screen.getByText('Core features')).toBeInTheDocument()

  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Installed' }))
  expect(screen.queryByText('Module template')).not.toBeInTheDocument()
  expect(screen.getByText('abacus')).toBeInTheDocument()

  await user.type(screen.getByRole('searchbox', { name: 'Search plugins' }), 'zzz')
  expect(screen.getByText('No matching plugins')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Clear filters' }))
  expect(screen.getByText('Module template')).toBeInTheDocument()
  expect(screen.getByRole('searchbox', { name: 'Search plugins' })).toHaveValue('')

  await user.type(screen.getByRole('searchbox', { name: 'Search plugins' }), 'beads')
  expect(screen.queryByText('Module template')).not.toBeInTheDocument()
  expect(screen.getByText('abacus')).toBeInTheDocument()
})

test('a card opens a details dialog that lists what the plugin adds and installs it', async () => {
  const calls = catalog({})
  renderCatalog()
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Module template' }))
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByText('Pages')).toBeInTheDocument()
  expect(within(dialog).getByText('Cards')).toBeInTheDocument()
  await user.click(within(dialog).getByRole('button', { name: 'Install' }))
  await waitFor(() => expect(calls).toEqual(['install template']))
  expect(
    await within(dialog).findByRole('button', {
      name: 'Installed (Module template), more options',
    }),
  ).toBeInTheDocument()
})

test('uninstalling from a card asks first and can delete the data', async () => {
  const calls = catalog({ abacus: true })
  renderCatalog()
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Installed (abacus), more options' }))
  await user.click(await screen.findByRole('menuitem', { name: 'Uninstall' }))
  const confirm = await screen.findByRole('alertdialog')
  expect(within(confirm).getByText('Uninstall abacus?')).toBeInTheDocument()
  await user.click(within(confirm).getByRole('checkbox'))
  await user.click(within(confirm).getByRole('button', { name: 'Uninstall and delete data' }))
  await waitFor(() => expect(calls).toEqual(['uninstall abacus purge=true']))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  const card = (await screen.findByText('abacus')).closest('li')!
  expect(await within(card).findByRole('button', { name: 'Install' })).toBeInTheDocument()
})
