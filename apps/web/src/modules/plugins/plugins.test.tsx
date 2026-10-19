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
function catalog(initial: Record<string, boolean>, { failUninstall = false } = {}) {
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
      if (failUninstall) {
        calls.push(`uninstall ${id} failed`)
        return HttpResponse.json(
          { error: { code: 'internal', params: {}, request_id: 'r1' } },
          { status: 500 },
        )
      }
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
  // Once installed, the dialog shows the plugin's settings.
  templateSettings()
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

/** The template plugin's account settings (namespace `plugin.template`). */
function templateSettings() {
  server.use(
    http.get(`${API}/settings/schemas`, () =>
      HttpResponse.json({
        items: [
          {
            namespace: 'plugin.template',
            levels: ['account'],
            plugin_id: 'template',
            json_schema: {
              type: 'object',
              properties: { compact: { type: 'boolean', default: false } },
            },
          },
        ],
      }),
    ),
    http.get(`${API}/settings/plugin.template`, () =>
      HttpResponse.json({
        namespace: 'plugin.template',
        scope_type: 'account',
        scope_id: null,
        values: { compact: false },
        sources: { compact: 'default' },
        inherited: {},
      }),
    ),
  )
}

test('uninstalling from the details dialog keeps it open and drops the plugin settings', async () => {
  const calls = catalog({ template: true })
  templateSettings()
  renderCatalog()
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Module template' }))
  const dialog = await screen.findByRole('dialog')
  expect(await within(dialog).findByText('Compact task list')).toBeInTheDocument()
  // In the dialog the installed menu has no "Details": it only uninstalls.
  await user.click(
    within(dialog).getByRole('button', { name: 'Installed (Module template), more options' }),
  )
  expect(screen.queryByRole('menuitem', { name: 'Details' })).not.toBeInTheDocument()
  await user.click(await screen.findByRole('menuitem', { name: 'Uninstall' }))
  const confirm = await screen.findByRole('alertdialog')
  await user.click(within(confirm).getByRole('button', { name: 'Uninstall' }))
  await waitFor(() => expect(calls).toEqual(['uninstall template purge=false']))
  expect(await within(dialog).findByRole('button', { name: 'Install' })).toBeInTheDocument()
  expect(screen.getByRole('dialog')).toBe(dialog)
  expect(within(dialog).queryByText('Compact task list')).not.toBeInTheDocument()
})

test('a failed uninstall keeps the confirmation open', async () => {
  const calls = catalog({ abacus: true }, { failUninstall: true })
  renderCatalog()
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Installed (abacus), more options' }))
  await user.click(await screen.findByRole('menuitem', { name: 'Uninstall' }))
  const confirm = await screen.findByRole('alertdialog')
  await user.click(within(confirm).getByRole('button', { name: 'Uninstall' }))
  await waitFor(() => expect(calls).toEqual(['uninstall abacus failed']))
  await waitFor(() =>
    expect(within(confirm).getByRole('button', { name: 'Uninstall' })).toBeEnabled(),
  )
  expect(screen.getByRole('alertdialog')).toBe(confirm)
})

test('"Installed" with nothing installed says so and leads back to all plugins', async () => {
  catalog({})
  renderCatalog()
  const user = userEvent.setup()
  await screen.findByText('Module template')
  await user.click(screen.getByRole('button', { name: 'Installed' }))
  expect(screen.getByText('No plugins installed yet')).toBeInTheDocument()
  expect(screen.queryByText('No matching plugins')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Browse all' }))
  expect(screen.getByText('Module template')).toBeInTheDocument()
})

test('Esc on the uninstall confirmation closes only the confirmation', async () => {
  catalog({ abacus: true })
  renderCatalog()
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'abacus' }))
  const dialog = await screen.findByRole('dialog')
  await user.click(within(dialog).getByRole('button', { name: 'Installed (abacus), more options' }))
  await user.click(await screen.findByRole('menuitem', { name: 'Uninstall' }))
  await screen.findByRole('alertdialog')
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  expect(screen.getByRole('dialog')).toBe(dialog)
})
