import type { FolderOut, ItemOut } from '@semestra/api-client'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { useState } from 'react'
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest'
import { course } from '@/modules/academics/test-data'
import { API, renderWithQuery, server } from '@/test-utils'
import { FilePicker } from './components/FilePicker'

beforeAll(() => server.listen())
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function folder(id: string, name: string, parent_id: string | null = null): FolderOut {
  const at = '2026-09-01T00:00:00Z'
  return { id, course_id: 'c1', parent_id, name, item_count: 0, created_at: at, updated_at: at }
}

function file(id: string, name: string, folder_id: string | null): ItemOut {
  const at = '2026-09-01T00:00:00Z'
  return {
    id,
    course_id: 'c1',
    folder_id,
    kind: 'file',
    display_name: name,
    original_name: name,
    mime_type: 'application/pdf',
    size_bytes: 2048,
    sha256: id,
    stored: true,
    follows_source: false,
    local_copy: null,
    url: null,
    pinned: false,
    source_kind: null,
    doc_status: 'ready',
    doc_error_code: null,
    page_count: 3,
    ocr_skipped_pages: 0,
    job_id: null,
    source_name: null,
    unseen: false,
    created_at: at,
    updated_at: at,
    modified_at: at,
  } as ItemOut
}

/** A course with more files than open by default: one folder per week, two files each. */
function bigCourse(courseId: string, extra: ItemOut[] = []) {
  const folders = Array.from({ length: 9 }, (_, i) =>
    folder(`${courseId}-w${i + 1}`, `Week ${i + 1}`),
  )
  const items = folders.flatMap((f, i) => [
    file(`${f.id}-a`, `Lecture ${i + 1}.pdf`, f.id),
    file(`${f.id}-b`, `Problem set ${i + 1}.pdf`, f.id),
  ])
  items.push(file(`${courseId}-outline`, 'Course outline.pdf', null), ...extra)
  server.use(
    http.get(`${API}/courses/${courseId}/files`, () =>
      HttpResponse.json({ folders, items, next_cursor: null }),
    ),
  )
}

function Picker({
  picked = ['c1-w2-a'],
  ...props
}: {
  courseId?: string
  courses?: ReturnType<typeof course>[]
  max?: number
  picked?: string[]
}) {
  const [selected, setSelected] = useState<string[]>(picked)
  return (
    <>
      <FilePicker {...props} selected={selected} onChange={setSelected} emptyTitle="Nothing" />
      <output>{selected.join(',')}</output>
    </>
  )
}

test('folders stay closed in a big course, and a closed folder says how many files are picked in it', async () => {
  bigCourse('c1')
  renderWithQuery(<Picker courseId="c1" />)
  const week1 = await screen.findByRole('button', { name: /^Week 1$/ })
  expect(week1).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('checkbox', { name: 'Lecture 1.pdf' })).toBeNull()
  // The folder holding the picked file starts open.
  expect(screen.getByRole('checkbox', { name: 'Lecture 2.pdf' })).toBeChecked()

  await userEvent.click(screen.getByRole('button', { name: /^Week 2/ }))
  expect(screen.getByRole('button', { name: /^Week 2/ })).toHaveTextContent('1 selected')

  await userEvent.click(week1)
  await userEvent.click(screen.getByRole('checkbox', { name: 'Lecture 1.pdf' }))
  expect(screen.getByRole('status')).toHaveTextContent('c1-w2-a,c1-w1-a')
})

test('a search matches file names and the folders files are in', async () => {
  bigCourse('c1')
  renderWithQuery(<Picker courseId="c1" />)
  const search = await screen.findByRole('searchbox', { name: 'Search files or folders' })

  await userEvent.type(search, 'week 3')
  expect(screen.getByRole('checkbox', { name: 'Lecture 3.pdf' })).toBeInTheDocument()
  expect(screen.getByRole('checkbox', { name: 'Problem set 3.pdf' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /^Week 1$/ })).toBeNull()

  await userEvent.clear(search)
  await userEvent.type(search, 'outline')
  expect(screen.getByRole('checkbox', { name: 'Course outline.pdf' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /^Week/ })).toBeNull()

  await userEvent.clear(search)
  await userEvent.type(search, 'nothing like this')
  expect(screen.getByText('No matching files')).toBeInTheDocument()
})

test("a term's courses are at the top, and no more files can be ticked once the limit is reached", async () => {
  bigCourse('c1')
  bigCourse('c2')
  const courses = [
    course({ id: 'c1', code: 'MAT137Y1', term_ids: ['t1'] }),
    course({ id: 'c2', code: 'CSC110Y1', term_ids: ['t1'] }),
  ]
  renderWithQuery(<Picker courses={courses} max={2} />)
  // The course holding the pick opens; the other stays closed.
  const mat = await screen.findByRole('button', { name: /MAT137Y1/ })
  expect(mat).toHaveAttribute('aria-expanded', 'true')
  const csc = screen.getByRole('button', { name: /CSC110Y1/ })
  expect(csc).toHaveAttribute('aria-expanded', 'false')
  await userEvent.click(mat)
  expect(mat).toHaveTextContent('1 selected')

  await userEvent.click(csc)
  const list = screen.getByRole('button', { name: /CSC110Y1/ }).parentElement as HTMLElement
  await userEvent.click(within(list).getByRole('checkbox', { name: 'Course outline.pdf' }))
  expect(screen.getByRole('status')).toHaveTextContent('c1-w2-a,c2-outline')
  // Two picked: the rest wait until one is unticked.
  await userEvent.click(within(list).getByRole('button', { name: /^Week 1$/ }))
  expect(within(list).getByRole('checkbox', { name: 'Lecture 1.pdf' })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
})

test('unticking the last picked file in a folder leaves the folder open', async () => {
  bigCourse('c1')
  renderWithQuery(<Picker courseId="c1" />)
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Lecture 2.pdf' }))
  expect(screen.getByRole('status')).toHaveTextContent('')
  expect(screen.getByRole('button', { name: /^Week 2/ })).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByRole('checkbox', { name: 'Lecture 2.pdf' })).not.toBeChecked()
})

test('a folder can be closed while searching, and opens again with the next search', async () => {
  bigCourse('c1')
  renderWithQuery(<Picker courseId="c1" />)
  const search = await screen.findByRole('searchbox', { name: 'Search files or folders' })
  await userEvent.type(search, 'lecture')
  const week4 = screen.getByRole('button', { name: /^Week 4/ })
  expect(week4).toHaveAttribute('aria-expanded', 'true')
  await userEvent.click(week4)
  expect(week4).toHaveAttribute('aria-expanded', 'false')
  await userEvent.type(search, ' 4')
  expect(screen.getByRole('button', { name: /^Week 4/ })).toHaveAttribute('aria-expanded', 'true')
  // Clearing the search goes back to the folders as they were.
  await userEvent.clear(search)
  expect(screen.getByRole('button', { name: /^Week 4/ })).toHaveAttribute('aria-expanded', 'false')
})

test('links can be picked and unpicked where the site allows them', async () => {
  const link = {
    ...file('c1-piazza', 'Piazza', null),
    kind: 'link',
    url: 'https://piazza.com',
  } as ItemOut
  bigCourse('c1', [link])
  renderWithQuery(<Picker courseId="c1" picked={['c1-piazza']} />)
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Piazza' }))
  expect(screen.getByRole('status')).toHaveTextContent('')
})

test('a course whose files could not be loaded says so instead of looking empty', async () => {
  server.use(
    http.get(`${API}/courses/c1/files`, () =>
      HttpResponse.json({ error: { code: 'internal', params: {} } }, { status: 500 }),
    ),
  )
  renderWithQuery(<Picker courseId="c1" />)
  expect(await screen.findByText("Couldn't load this course's files.")).toBeInTheDocument()
  expect(screen.queryByText('Nothing')).toBeNull()
})
