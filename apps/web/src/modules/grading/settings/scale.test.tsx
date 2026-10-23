import type { GradingScale, ScalePreset } from '@semestra/api-client'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest'
import { API, renderWithRouter, server } from '@/test-utils'
import { ProgramGradingSection } from './ProgramGradingSection'

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const UOFT: ScalePreset = {
  id: 'uoft_4_0',
  max_points: 4,
  bands: [
    { min: 85, max: 100, points: 4, letter: 'A' },
    { min: 0, max: 84, points: 0, letter: 'F' },
  ],
}
const US: ScalePreset = {
  id: 'us_4_0',
  max_points: 4,
  bands: [
    { min: 93, max: 100, points: 4, letter: 'A' },
    { min: 0, max: 92, points: 0, letter: 'F' },
  ],
}
const CUSTOM: ScalePreset = {
  id: 'custom',
  max_points: 4,
  bands: [{ min: 0, max: 100, points: 0, letter: null }],
}

const scaleOf = (preset: ScalePreset): GradingScale => ({
  program_id: 'p1',
  bands: preset.bands,
  max_points: preset.max_points,
  year_course_attribution: 'end_term',
  default_forecast_model: 'auto',
  default_categories: [],
  hide_gpa: false,
  round_before_lookup: true,
  updated_at: '2026-10-23T00:00:00Z',
})

/** A Program on the US table, with the server keeping whatever table is PUT. */
function serve() {
  let scale = scaleOf(US)
  const puts: unknown[] = []
  server.use(
    http.get(`${API}/grading/scale-presets`, () =>
      HttpResponse.json({ items: [UOFT, US, CUSTOM] }),
    ),
    http.get(`${API}/programs/p1/grading-scale`, () => HttpResponse.json(scale)),
    http.put(`${API}/programs/p1/grading-scale`, async ({ request }) => {
      const body = (await request.json()) as Partial<GradingScale>
      puts.push(body)
      scale = { ...scale, ...body }
      return HttpResponse.json(scale)
    }),
  )
  return puts
}

const minInputs = () => screen.getAllByRole('textbox', { name: /: min$/ })

test('the preset picker shows the table in use and switches it after a confirmation', async () => {
  const puts = serve()
  const user = userEvent.setup()
  renderWithRouter(<ProgramGradingSection scope={{ kind: 'program', programId: 'p1' }} />)

  const picker = await screen.findByRole('combobox', { name: 'Preset' })
  await waitFor(() => expect(picker).toHaveTextContent('US letter grades (4.0)'))

  // Cancelling keeps the table and the picker as they were.
  await user.click(picker)
  await user.click(await screen.findByRole('option', { name: /University of Toronto/ }))
  let dialog = await screen.findByRole('alertdialog')
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  expect(picker).toHaveTextContent('US letter grades (4.0)')
  expect(puts).toEqual([])

  await user.click(picker)
  await user.click(await screen.findByRole('option', { name: /University of Toronto/ }))
  dialog = await screen.findByRole('alertdialog')
  expect(dialog).toHaveTextContent('Switch to University of Toronto (4.0)?')
  await user.click(within(dialog).getByRole('button', { name: 'Switch table' }))

  await waitFor(() => expect(puts).toEqual([{ bands: UOFT.bands, max_points: 4 }]))
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: 'Preset' })).toHaveTextContent(
      'University of Toronto (4.0)',
    ),
  )
  expect(minInputs().map((input) => (input as HTMLInputElement).value)).toEqual(['0', '85'])
})

test('an edited table shows as Custom, apart from the blank-table preset, and picking the saved preset discards the edits', async () => {
  const puts = serve()
  const user = userEvent.setup()
  renderWithRouter(<ProgramGradingSection scope={{ kind: 'program', programId: 'p1' }} />)

  const picker = await screen.findByRole('combobox', { name: 'Preset' })
  await waitFor(() => expect(picker).toHaveTextContent('US letter grades (4.0)'))
  const top = screen.getByRole('textbox', { name: 'Band 2: min' })
  // The same number typed differently is still the preset.
  await user.clear(top)
  await user.type(top, '93.0')
  expect(picker).toHaveTextContent('US letter grades (4.0)')
  await user.clear(top)
  await user.type(top, '90')
  expect(picker).toHaveTextContent('Custom')

  await user.click(picker)
  expect(await screen.findByRole('option', { name: /^Custom/ })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
  expect(screen.getByRole('option', { name: /Blank table/ })).not.toHaveAttribute(
    'aria-disabled',
    'true',
  )
  await user.click(screen.getByRole('option', { name: /US letter grades \(4\.0\)/ }))
  const dialog = await screen.findByRole('alertdialog')
  expect(dialog).toHaveTextContent('Discard changes to the table?')
  await user.click(within(dialog).getByRole('button', { name: 'Discard changes' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  await waitFor(() => expect(picker).toHaveTextContent('US letter grades (4.0)'))
  expect(minInputs().map((input) => (input as HTMLInputElement).value)).toEqual(['0', '93'])
  expect(puts).toEqual([])

  // Switching with unsaved edits says they are lost.
  await user.clear(top)
  await user.type(top, '90')
  await user.click(picker)
  await user.click(await screen.findByRole('option', { name: /University of Toronto/ }))
  expect(await screen.findByRole('alertdialog')).toHaveTextContent(
    'Unsaved changes to the table are lost.',
  )
})
