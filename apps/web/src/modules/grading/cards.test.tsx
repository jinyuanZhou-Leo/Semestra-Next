import type { ProgramGrades } from '@semestra/api-client'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest'
import type { CardProps } from '@/app/extensions'
import { API, renderWithRouter, server } from '@/test-utils'
import ProgramChartsCard from './cards/ProgramChartsCard'
import CourseSummaryCard from './cards/CourseSummaryCard'
import { gradebook, summary } from './test-data'

beforeAll(() => server.listen())
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const cardProps = (scope: CardProps['scope'], size: CardProps['size']): CardProps => ({
  scope,
  size,
  instanceId: 'i1',
  settings: {},
})

function programGrades(hide: boolean): ProgramGrades {
  return {
    program_id: 'p1',
    max_points: 4,
    hide_gpa: hide,
    gpa: 3.5,
    average_percentage: 82,
    credits_counted: 1,
    credits_earned: 1,
    credits_required: null,
    progress: null,
    graded_course_count: 2,
    term_count: 1,
    terms: [
      {
        term_id: 't1',
        name: 'Fall 2025',
        start_date: '2025-09-04',
        gpa: 3.5,
        cumulative_gpa: 3.5,
        credits_counted: 1,
        cumulative_credits: 1,
      },
    ],
  }
}

test('the Program chart keeps GPA values out of the page while GPA is hidden', async () => {
  server.use(
    http.get(`${API}/programs/p1/grade-summary`, () => HttpResponse.json(programGrades(true))),
  )
  const { container } = renderWithRouter(
    <ProgramChartsCard {...cardProps({ kind: 'program', programId: 'p1' }, 'l')} />,
  )
  const mask = await screen.findByRole('button', { name: 'Show GPA' })
  expect(container.querySelector('title')?.textContent ?? '').not.toContain('3.50')
  expect(screen.queryByRole('img', { name: 'GPA and cumulative GPA by term' })).toBeNull()
  await userEvent.click(mask)
  const chart = await screen.findByRole('img', { name: 'GPA and cumulative GPA by term' })
  expect(chart.querySelector('title')?.textContent).toBe('Fall 2025: 3.50')
})

test('the Program chart is drawn straight away when GPA is not hidden', async () => {
  server.use(
    http.get(`${API}/programs/p1/grade-summary`, () => HttpResponse.json(programGrades(false))),
  )
  renderWithRouter(<ProgramChartsCard {...cardProps({ kind: 'program', programId: 'p1' }, 'l')} />)
  expect(
    await screen.findByRole('img', { name: 'GPA and cumulative GPA by term' }),
  ).toBeInTheDocument()
})

test('a course without a gradebook shows its typed-in final grade on the card', async () => {
  const book = gradebook({
    result: { ...gradebook().result, gradebook_enabled: false, manual_percentage: 91 },
    summary: summary({
      weights_ok: false,
      weight_total: 0,
      current_percentage: null,
      current_points: null,
      current_letter: null,
      final_percentage: 91,
      final_points: 4,
      final_letter: 'A+',
      final_source: 'manual',
    }),
  })
  server.use(http.get(`${API}/courses/c1/gradebook`, () => HttpResponse.json(book)))
  renderWithRouter(
    <CourseSummaryCard {...cardProps({ kind: 'course', programId: 'p1', courseId: 'c1' }, 'm')} />,
  )
  expect(await screen.findByText('91%')).toBeInTheDocument()
})

test('revealing a hidden GPA on a card does not follow the card link', async () => {
  const book = gradebook({ scale: { max_points: 4, hide_gpa: true } })
  server.use(http.get(`${API}/courses/c1/gradebook`, () => HttpResponse.json(book)))
  const { router } = renderWithRouter(
    <CourseSummaryCard {...cardProps({ kind: 'course', programId: 'p1', courseId: 'c1' }, 'm')} />,
  )
  await userEvent.click(await screen.findByRole('button', { name: 'Show GPA' }))
  expect(await screen.findByText('3.70')).toBeInTheDocument()
  expect(router.history.location.pathname).toBe('/')
})
