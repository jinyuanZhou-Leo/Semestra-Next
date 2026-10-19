import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest'
import { API, renderWithRouter, server } from '@/test-utils'
import { category, gradebook } from '../test-data'
import { CourseGradingSection } from './CourseGradingSection'

beforeAll(() => server.listen())
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const book = gradebook({
  categories: [
    category({ id: 'k1', key: 'quiz', name: 'Quiz', position: 0 }),
    category({ id: 'k2', key: 'exam', name: 'Exam', position: 1 }),
  ],
})

test('categories reorder from the row menu and switch off with a plain "In use" toggle', async () => {
  const orders: unknown[] = []
  const patches: unknown[] = []
  server.use(
    http.get(`${API}/courses/c1/gradebook`, () => HttpResponse.json(book)),
    http.put(`${API}/courses/c1/grading-category-order`, async ({ request }) => {
      orders.push(await request.json())
      return HttpResponse.json({ ok: true })
    }),
    http.patch(`${API}/grading-categories/:id`, async ({ request }) => {
      patches.push(await request.json())
      return HttpResponse.json(book.categories[0])
    }),
  )
  const user = userEvent.setup()
  renderWithRouter(
    <CourseGradingSection scope={{ kind: 'course', programId: 'p1', courseId: 'c1' }} />,
  )

  const table = await screen.findByRole('table', { name: 'Categories' })
  expect(within(table).getByRole('button', { name: 'Drag Quiz to reorder' })).toBeInTheDocument()
  expect(
    screen.getByText(/can't be picked for new assessments/, { selector: 'p' }),
  ).toBeInTheDocument()

  await user.click(within(table).getByRole('button', { name: 'Actions for Quiz' }))
  expect(await screen.findByRole('menuitem', { name: 'Move up' })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
  await user.click(screen.getByRole('menuitem', { name: 'Move down' }))
  await waitFor(() => expect(orders).toEqual([{ category_ids: ['k2', 'k1'] }]))

  await user.click(within(table).getByRole('switch', { name: 'In use: Exam' }))
  await waitFor(() => expect(patches).toEqual([{ archived: true }]))
})
