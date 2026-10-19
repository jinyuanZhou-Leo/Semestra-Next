import type { ItemOut } from '@semestra/api-client'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer'
import { http, HttpResponse } from 'msw'
import { type ReactNode, useEffect } from 'react'
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import type { Scope } from '@/app/extensions'
import { API, renderWithRouter, server } from '@/test-utils'
import { highlightHtml, searchTerms, snippetParts } from './highlight'
import { Citation } from './components/Citation'
import CourseFilesPage from './pages/CourseFilesPage'
import { findDuplicates, planUpload } from './upload'

// pdf.js does not run in jsdom; the viewer's page is enough to check where it opens.
vi.mock('react-pdf', () => ({
  pdfjs: { GlobalWorkerOptions: {} },
  Document: ({
    children,
    onLoadSuccess,
  }: {
    children: ReactNode
    onLoadSuccess: (doc: { numPages: number }) => void
  }) => {
    useEffect(() => onLoadSuccess({ numPages: 9 }), [onLoadSuccess])
    return <div>{children}</div>
  },
  Page: ({ pageNumber }: { pageNumber: number }) => <p>PDF page {pageNumber}</p>,
}))

beforeAll(async () => {
  server.listen()
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

const scope: Scope = { kind: 'course', programId: 'p1', courseId: 'c1' }

function item(overrides: Partial<ItemOut> = {}): ItemOut {
  return {
    id: 'i1',
    course_id: 'c1',
    folder_id: null,
    kind: 'file',
    display_name: 'syllabus.pdf',
    original_name: 'syllabus.pdf',
    mime_type: 'application/pdf',
    size_bytes: 2048,
    sha256: 'aa',
    url: null,
    pinned: false,
    source_kind: 'upload',
    source_ref: null,
    doc_status: 'ready',
    doc_error_code: null,
    page_count: 9,
    ocr_skipped_pages: 0,
    job_id: null,
    created_at: '2026-01-10T12:00:00Z',
    updated_at: '2026-01-10T12:00:00Z',
    ...overrides,
  }
}

let items: ItemOut[] = []
let uploads: string[] = []
let prefs: { key: string; body: unknown }[] = []

beforeEach(() => {
  items = [
    item(),
    item({
      id: 'l1',
      kind: 'link',
      display_name: 'Piazza',
      original_name: null,
      mime_type: null,
      size_bytes: 0,
      sha256: null,
      url: 'https://piazza.com/class/aps105',
      doc_status: 'none',
    }),
  ]
  uploads = []
  prefs = []
  server.use(
    http.post(`${API}/me/ui-state\\:get`, () => HttpResponse.json({ items: {} })),
    http.put(`${API}/me/ui-state/:key`, async ({ request, params }) => {
      prefs.push({ key: String(params.key), body: await request.json() })
      return HttpResponse.json({ ok: true })
    }),
    http.get(`${API}/courses/c1/files`, () =>
      HttpResponse.json({ folders: [], items, next_cursor: null }),
    ),
    http.get(`${API}/files/:id`, ({ params }) =>
      HttpResponse.json(items.find((i) => i.id === params.id)),
    ),
    http.get(`${API}/files-usage`, () =>
      HttpResponse.json({
        used_bytes: 2048,
        files_bytes: 2048,
        quota_bytes: 52_428_800,
        max_upload_bytes: 26_214_400,
      }),
    ),
    http.post(`${API}/courses/c1/files`, async ({ request }) => {
      uploads.push(await request.text())
      return HttpResponse.json({ items: [item({ id: 'new', display_name: 'notes.txt' })] })
    }),
    http.post(`${API}/programs/p1/files\\:search`, () =>
      HttpResponse.json({
        results: [
          {
            item_id: 'i1',
            display_name: 'syllabus.pdf',
            course_id: 'c1',
            page_from: 3,
            page_to: 3,
            heading_path: ['Grading'],
            snippet: 'The <mark>midterm</mark> is worth 30%',
            score: 0.03,
            citation_id: 'i1:p3-3',
          },
        ],
        pending_items: [],
        mode_used: 'keyword',
      }),
    ),
  )
})

const mount = () => renderWithRouter(<CourseFilesPage scope={scope} />)

test('files dropped anywhere on the page are uploaded to the course', async () => {
  mount()
  expect(await screen.findByRole('button', { name: 'syllabus.pdf' })).toBeInTheDocument()
  const file = new File(['hello'], 'notes.txt', { type: 'text/plain' })
  const dataTransfer = { types: ['Files'], files: [file] }

  fireEvent.dragEnter(window, { dataTransfer })
  expect(await screen.findByText('Drop files to upload to All files')).toBeInTheDocument()
  fireEvent.drop(window, { dataTransfer })

  await waitFor(() => expect(uploads).toHaveLength(1))
  expect(uploads[0]).toContain('filename="notes.txt"')
  expect(uploads[0]).toContain('hello')
  expect(screen.queryByText('Drop files to upload to All files')).not.toBeInTheDocument()
  expect(await screen.findByText('Uploads finished')).toBeInTheDocument()
})

test('a search hit opens the preview on its page', async () => {
  mount()
  await userEvent.type(await screen.findByRole('searchbox'), 'midterm')
  const hit = await screen.findByRole('button', { name: /^syllabus\.pdf\s*p\. 3/ })
  expect(within(hit).getByText('midterm').tagName).toBe('MARK')
  await userEvent.click(hit)
  expect(await screen.findByText('PDF page 3')).toBeInTheDocument()
})

test('links ask before leaving, and can remember the site', async () => {
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  mount()
  await userEvent.click(await screen.findByRole('button', { name: 'Piazza' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(dialog).toHaveTextContent('https://piazza.com/class/aps105')
  expect(open).not.toHaveBeenCalled()

  await userEvent.click(within(dialog).getByRole('checkbox', { name: /piazza\.com/ }))
  await userEvent.click(within(dialog).getByRole('button', { name: 'Open' }))
  expect(open).toHaveBeenCalledWith(
    'https://piazza.com/class/aps105',
    '_blank',
    'noopener,noreferrer',
  )
  await waitFor(() =>
    expect(prefs).toContainEqual({
      key: 'files.trusted_domains',
      body: { value: ['piazza.com'] },
    }),
  )

  // Trusted now: the next click opens straight away.
  await userEvent.click(screen.getByRole('button', { name: 'Piazza' }))
  await act(() => Promise.resolve())
  expect(open).toHaveBeenCalledTimes(2)
  open.mockRestore()
})

test('uploads that cannot fit are refused before sending', () => {
  const big = new File(['x'.repeat(10)], 'big.pdf')
  const small = new File(['x'], 'small.pdf')
  const usage = { used_bytes: 95, files_bytes: 95, quota_bytes: 100, max_upload_bytes: 8 }
  const plan = planUpload([big, small], usage)
  expect(plan.tooLarge).toEqual([big])
  expect(plan.accepted).toEqual([small])
  expect(plan.room).toBe(true)
  expect(planUpload([small, small, small, small, small, small], usage).room).toBe(false)
  expect(planUpload([big], { ...usage, quota_bytes: 0, max_upload_bytes: 100 }).room).toBe(true)
})

test('duplicates are the same bytes in the course or the same name in the folder', () => {
  const same = new File(['a'], 'other-name.pdf')
  const named = new File(['b'], 'Syllabus.PDF')
  const fresh = new File(['c'], 'fresh.pdf')
  const dupes = findDuplicates(
    [
      { file: same, sha256: 'aa' },
      { file: named, sha256: 'bb' },
      { file: fresh, sha256: 'cc' },
    ],
    [item()],
    null,
  )
  expect([...dupes]).toEqual([same, named])
  expect([...findDuplicates([{ file: named, sha256: 'bb' }], [item()], 'folder-2')]).toEqual([])
})

test('highlighting escapes file text and marks every match', () => {
  expect(highlightHtml('<b>Midterm</b> & midterm', ['midterm'])).toBe(
    '&lt;b&gt;<mark>Midterm</mark>&lt;/b&gt; &amp; <mark>midterm</mark>',
  )
  expect(searchTerms('midterm, 期中考试 a')).toEqual(['midterm', '期中考试'])
  expect(snippetParts('a <mark>b</mark> c')).toEqual([
    { text: 'a ', marked: false },
    { text: 'b', marked: true },
    { text: ' c', marked: false },
  ])
})

test('a citation names the file and pages and opens the preview there', async () => {
  renderWithRouter(<Citation id="i1:p4-5" />)
  const chip = await screen.findByRole('button', { name: /syllabus\.pdf\s*pp\. 4–5/ })
  await userEvent.click(chip)
  expect(await screen.findByText('PDF page 4')).toBeInTheDocument()
})
