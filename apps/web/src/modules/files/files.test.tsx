import type { DuplicateCheckInputBody, FolderOut, ItemOut } from '@semestra/api-client'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer'
import { http, HttpResponse } from 'msw'
import { type ReactNode, useEffect, useState } from 'react'
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import type { Scope } from '@/app/extensions'
import { API, renderWithRouter, server } from '@/test-utils'
import { searchTerms, snippetParts, textRanges } from './highlight'
import { Citation } from './components/Citation'
import { DocumentText } from './components/DocumentText'
import { type Target, canMoveInto, canMoveIntoNewFolder, folderTree } from './folders'
import { course } from '@/modules/academics/test-data'
import CourseFilesPage from './pages/CourseFilesPage'
import TermFilesPage from './pages/TermFilesPage'
import { pageTarget } from './page-target'
import { Toaster } from '@/ui/sonner'
import { planUpload } from './upload'

// pdf.js does not run in jsdom; the viewer's page is enough to check where it opens.
vi.mock('react-pdf', () => ({
  pdfjs: { GlobalWorkerOptions: {} },
  // A file whose id starts with "offline" cannot be read (its platform is unreachable).
  Document: ({
    children,
    file,
    onLoadSuccess,
    onLoadError,
  }: {
    children: ReactNode
    file: string
    onLoadSuccess: (doc: unknown) => void
    onLoadError?: () => void
  }) => {
    useEffect(() => {
      if (file.includes('/files/offline')) {
        onLoadError?.()
        return
      }
      onLoadSuccess({
        numPages: 9,
        getPage: async () => ({ getViewport: () => ({ width: 210, height: 297 }) }),
      })
    }, [file, onLoadSuccess, onLoadError])
    return <div>{children}</div>
  },
  Page: ({ pageNumber }: { pageNumber: number }) => (
    <p>
      PDF page {pageNumber}{' '}
      <a href={`https://example.com/notes/${pageNumber}`}>notes {pageNumber}</a>
    </p>
  ),
}))

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
    stored: true,
    follows_source: false,
    local_copy: null,
    url: null,
    pinned: false,
    source_kind: null,
    doc_status: 'ready',
    doc_error_code: null,
    page_count: 9,
    ocr_skipped_pages: 0,
    job_id: null,
    source_name: null,
    unseen: false,
    created_at: '2026-01-10T12:00:00Z',
    updated_at: '2026-01-10T12:00:00Z',
    modified_at: '2026-01-10T12:00:00Z',
    ...overrides,
  }
}

const CORS = {
  'Access-Control-Allow-Origin': window.location.origin,
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Allow-Headers': '*',
}

let items: ItemOut[] = []
let uploads: string[] = []
let prefs: { key: string; body: unknown }[] = []
let searches: unknown[] = []

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
  searches = []
  server.use(
    http.get(`${API}/ai/status`, () => HttpResponse.json({ items: [] })),
    http.post(`${API}/me/ui-state\\:get`, () => HttpResponse.json({ items: {} })),
    http.get(`${API}/courses/c1/files\\:organize`, () =>
      HttpResponse.json({ job: null, plan: null }),
    ),
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
        vector_files: 0,
      }),
    ),
    // Uploads go through XHR for their progress: a cross-origin preflight in tests.
    http.options(
      `${API}/courses/c1/files`,
      () => new HttpResponse(null, { status: 204, headers: CORS }),
    ),
    http.post(`${API}/courses/c1/files`, async ({ request }) => {
      uploads.push(await request.text())
      return HttpResponse.json(
        { items: [item({ id: 'new', display_name: 'notes.txt' })] },
        { headers: CORS },
      )
    }),
    // The server's rule, as far as these tests need it: a name already there or on its way.
    http.post(`${API}/courses/c1/files\\:check-duplicates`, async ({ request }) => {
      const { files, pending = [] } = (await request.json()) as DuplicateCheckInputBody
      const names = new Set(
        [...items, ...pending].map((f) => ('name' in f ? f.name : f.display_name)),
      )
      return HttpResponse.json({
        duplicates: files.flatMap((f, i) => (names.has(f.name) ? [i] : [])),
      })
    }),
    http.get(`${API}/files/:id/outline`, ({ params }) =>
      HttpResponse.json({
        item_id: params.id,
        display_name: 'syllabus.pdf',
        page_count: 9,
        entries: [
          { level: 1, title: 'Welcome', page: 1 },
          { level: 2, title: 'Schedule', page: 5 },
        ],
      }),
    ),
    http.get(`${API}/files/:id/document`, ({ params }) =>
      HttpResponse.json({
        item_id: params.id,
        display_name: 'syllabus.pdf',
        page_count: 9,
        pages: [{ page_no: 1, markdown: 'Read from page one', ocr_used: false, citation_id: 'x' }],
        next_page: null,
        citations: [],
      }),
    ),
    http.post(`${API}/programs/p1/files\\:search`, async ({ request }) => {
      searches.push(await request.json())
      return HttpResponse.json({
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
      })
    }),
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
  // jsdom's XMLHttpRequest does not encode FormData, so the panel row stands for the body.
  expect(screen.getByText('notes.txt')).toBeInTheDocument()
  expect(screen.queryByText('Drop files to upload to All files')).not.toBeInTheDocument()
  expect(await screen.findByText('Uploads finished')).toBeInTheDocument()
})

test('files dropped on a folder go into it, once', async () => {
  server.use(
    http.get(`${API}/courses/c1/files`, () =>
      HttpResponse.json({
        folders: [
          {
            id: 'f1',
            course_id: 'c1',
            parent_id: null,
            name: 'Week 1',
            created_at: '2026-01-10T12:00:00Z',
            updated_at: '2026-01-10T12:00:00Z',
          },
        ],
        items,
        next_cursor: null,
      }),
    ),
  )
  mount()
  const folder = (await screen.findByRole('button', { name: 'Week 1' })).closest('tr')!
  const file = new File(['hello'], 'notes.txt', { type: 'text/plain' })
  const dataTransfer = { types: ['Files'], files: [file] }

  fireEvent.dragEnter(window, { dataTransfer })
  fireEvent.dragOver(folder, { dataTransfer })
  expect(await screen.findByText('Drop files to upload to Week 1')).toBeInTheDocument()
  fireEvent.drop(folder, { dataTransfer })

  await waitFor(() => expect(uploads).toHaveLength(1))
  expect(await screen.findByText('Uploads finished')).toBeInTheDocument()
  // The page's own drop zone saw the drop too, and left it to the folder.
  expect(uploads).toHaveLength(1)
})

test('the same file picked again while the first is still uploading is asked about', async () => {
  let release = () => {}
  const held = new Promise<void>((resolve) => (release = resolve))
  server.use(
    http.post(`${API}/courses/c1/files`, async ({ request }) => {
      uploads.push(await request.text())
      await held
      return HttpResponse.json({ items: [item({ id: 'new' })] }, { headers: CORS })
    }),
  )
  const user = userEvent.setup()
  mount()
  expect(await screen.findByRole('button', { name: 'syllabus.pdf' })).toBeInTheDocument()
  const drop = () => {
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' })
    const dataTransfer = { types: ['Files'], files: [file] }
    fireEvent.dragEnter(window, { dataTransfer })
    fireEvent.drop(window, { dataTransfer })
  }
  drop()
  await waitFor(() => expect(uploads).toHaveLength(1))
  drop()
  const question = await screen.findByRole('alertdialog', { name: 'Some files already exist' })
  await user.click(within(question).getByRole('button', { name: 'Skip these' }))
  release()
  expect(await screen.findByText('Uploads finished')).toBeInTheDocument()
  expect(uploads).toHaveLength(1)
})

test('a folder name already used there shows under the name until it is changed', async () => {
  let code = 'files.folder_name_taken'
  server.use(
    http.post(`${API}/courses/c1/folders`, () =>
      HttpResponse.json(
        { error: { code, params: { name: 'Week 1' }, request_id: 'r' } },
        { status: code === 'files.folder_name_taken' ? 409 : 422 },
      ),
    ),
  )
  const user = userEvent.setup()
  mount()
  await user.click(await screen.findByRole('button', { name: 'New' }))
  await user.click(await screen.findByRole('menuitem', { name: 'New folder' }))
  const dialog = await screen.findByRole('dialog', { name: 'New folder' })
  const name = within(dialog).getByRole('textbox', { name: 'Name' })
  await user.type(name, 'week 1')
  await user.click(within(dialog).getByRole('button', { name: 'Create' }))
  expect(await within(dialog).findByText(/folder named “Week 1”/)).toBeInTheDocument()
  expect(name).toHaveAttribute('aria-invalid', 'true')
  await user.type(name, 's')
  expect(within(dialog).queryByText(/folder named “Week 1”/)).not.toBeInTheDocument()
  expect(name).not.toHaveAttribute('aria-invalid')

  // Any other error is about the request, not the name: it stays below the fields.
  code = 'files.folder_depth'
  await user.click(within(dialog).getByRole('button', { name: 'Create' }))
  expect(await within(dialog).findByText(/three levels deep/)).toBeInTheDocument()
  expect(name).not.toHaveAttribute('aria-invalid')
})

test('a search hit opens the preview on its page', async () => {
  mount()
  await userEvent.type(await screen.findByRole('searchbox'), 'midterm')
  const hit = await screen.findByRole('button', { name: /^syllabus\.pdf\s*p\. 3/ })
  expect(within(hit).getByText('midterm').tagName).toBe('MARK')
  await userEvent.click(hit)
  expect(await screen.findByText('PDF page 3')).toBeInTheDocument()
})

test('a search finds folders by name and opens one', async () => {
  server.use(
    http.get(`${API}/courses/c1/files`, () =>
      HttpResponse.json({
        folders: [
          {
            id: 'f1',
            course_id: 'c1',
            parent_id: null,
            name: 'Week 1',
            item_count: 2,
            created_at: '2026-01-10T12:00:00Z',
            updated_at: '2026-01-10T12:00:00Z',
          },
        ],
        items,
        next_cursor: null,
      }),
    ),
  )
  const user = userEvent.setup()
  const { router } = mount()
  await user.type(await screen.findByRole('searchbox'), 'week')
  // The folder row says where it is, under its name.
  const folder = (await screen.findByText('All files')).closest('button')
  expect(within(folder!).getByText('Week').tagName).toBe('MARK')
  await user.click(folder!)
  expect(router.state.location.search).toEqual({ folder: 'f1' })
  expect(screen.getByRole('searchbox')).toHaveValue('')
})

test('the search box has one clear button, and Esc clears it too', async () => {
  const user = userEvent.setup()
  mount()
  const box = await screen.findByRole('searchbox')
  expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument()
  await user.type(box, 'week')
  const field = box.closest<HTMLElement>('[data-slot="input-group"]')!
  await user.click(within(field).getByRole('button', { name: 'Clear search' }))
  expect(box).toHaveValue('')
  expect(box).toHaveFocus()
  await user.type(box, 'week{Escape}')
  expect(box).toHaveValue('')
})

test('a file new from the LMS is marked until opened, and shows where it is kept', async () => {
  const seen = vi.fn<(id: string) => void>()
  const calls: string[] = []
  items = [
    item({
      id: 'offline1',
      folder_id: 'f1',
      display_name: 'Week 3.pdf',
      stored: false,
      follows_source: true,
      local_copy: { state: 'online', error_code: null, saved_version_at: null },
      source_kind: 'lms',
      source_name: 'Canvas',
      url: 'https://q.utoronto.ca/courses/101/files/301',
      unseen: true,
      modified_at: '2026-02-01T12:00:00Z',
    }),
    item({
      id: 'big1',
      folder_id: 'f1',
      display_name: 'Recording.mp4',
      stored: false,
      follows_source: true,
      local_copy: { state: 'failed', error_code: 'files.too_large', saved_version_at: null },
      source_kind: 'lms',
      source_name: 'Canvas',
      url: 'https://q.utoronto.ca/courses/101/files/302',
    }),
  ]
  server.use(
    http.get(`${API}/programs/p1/lms-binding`, () =>
      HttpResponse.json({
        program_id: 'p1',
        connection_id: 'k1',
        connection: { id: 'k1', provider: 'canvas' },
        link_count: 1,
      }),
    ),
    http.get(`${API}/courses/c1/files`, () =>
      HttpResponse.json({
        folders: [makeFolder('f1', 'Lecture slides')],
        items,
        next_cursor: null,
      }),
    ),
    http.post(`${API}/files/:id\\:seen`, ({ params }) => {
      seen(String(params.id))
      items = items.map((i) => ({ ...i, unseen: false }))
      return HttpResponse.json(items[0])
    }),
    http.post(`${API}/files/:id\\:keep-copy`, ({ request }) => {
      calls.push(request.url.split(':').at(-1) ?? '')
      return HttpResponse.json(items[0])
    }),
  )
  const user = userEvent.setup()
  renderWithRouter(<CourseFilesPage scope={scope} />, undefined, {
    path: '/p/$programId',
    at: '/p/p1',
  })
  // The folder holding it is marked too.
  const folder = await screen.findByRole('button', { name: /^Lecture slides/ })
  expect(within(folder).getByText('New')).toBeInTheDocument()
  await user.click(folder)

  const name = await screen.findByRole('button', { name: /^Week 3\.pdf/ })
  expect(within(name).getByText('New')).toBeInTheDocument()
  expect(screen.getAllByText('Canvas')).toHaveLength(2)
  expect(screen.getByText('Read from Canvas')).toBeInTheDocument()

  // Wanted here but not saved: ticked, and the menu says why.
  expect(screen.getByText('Couldn’t save: the file exceeds the size limit')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Actions for Recording.mp4' }))
  const wanted = await screen.findByRole('menuitemcheckbox', { name: /^Save in Semestra/ })
  expect(wanted).toHaveAttribute('aria-checked', 'true')
  expect(
    within(wanted).getByText('Couldn’t save: the file exceeds the size limit'),
  ).toBeInTheDocument()
  await user.keyboard('{Escape}')

  // Read from Canvas until the user saves it in Semestra.
  await user.click(screen.getByRole('button', { name: 'Actions for Week 3.pdf' }))
  const save = await screen.findByRole('menuitemcheckbox', { name: /^Save in Semestra/ })
  expect(save).toHaveAttribute('aria-checked', 'false')
  expect(within(save).getByText('Still opens if deleted on Canvas.')).toBeInTheDocument()
  await user.click(save)
  await waitFor(() => expect(calls).toEqual(['keep-copy']))

  // Deleting it says what happens: no sync brings it back, and the sync status can restore it.
  await user.click(screen.getByRole('button', { name: 'Actions for Week 3.pdf' }))
  await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
  const confirm = await screen.findByRole('alertdialog')
  expect(
    within(confirm).getByText(
      "It won't sync from Canvas again. You can restore it under Removed materials in the sync status.",
    ),
  ).toBeInTheDocument()
  await user.click(within(confirm).getByRole('button', { name: 'Cancel' }))

  // Opened: no longer new. Canvas can't be reached: what was read from it last time instead.
  await user.click(name)
  await waitFor(() => expect(seen).toHaveBeenCalledWith('offline1'))
  expect(
    await screen.findByText("Can't read the original from Canvas right now"),
  ).toBeInTheDocument()
  expect(await screen.findByText('Read from page one')).toBeInTheDocument()
  // Where else it opens is one entry, not two look-alike icons.
  expect(screen.queryByRole('link', { name: 'Open in new tab' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Open in…' }))
  expect((await screen.findAllByRole('menuitem')).map((i) => i.textContent)).toEqual([
    'Open in new tab',
    'Open in Canvas',
  ])
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
  const usage = {
    used_bytes: 95,
    files_bytes: 95,
    quota_bytes: 100,
    max_upload_bytes: 8,
    vector_files: 0,
  }
  const plan = planUpload([big, small], usage)
  expect(plan.tooLarge).toEqual([big])
  expect(plan.accepted).toEqual([small])
  expect(plan.room).toBe(true)
  expect(planUpload([small, small, small, small, small, small], usage).room).toBe(false)
  expect(planUpload([big], { ...usage, quota_bytes: 0, max_upload_bytes: 100 }).room).toBe(true)
})

test('search terms are found across the elements a layout cut a word into', () => {
  const root = document.createElement('div')
  root.innerHTML = '<span>The Mid</span><span>term</span> and <span>midterm</span>'
  expect(textRanges(root, ['midterm']).map(String)).toEqual(['Midterm', 'midterm'])
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

const openPreview = async () => {
  renderWithRouter(<Citation id="i1:p1-1" />, undefined, { path: '/p/$programId', at: '/p/p1' })
  await userEvent.click(await screen.findByRole('button', { name: /syllabus\.pdf/ }))
  return screen.findByRole('dialog')
}

test('the preview goes to a heading of the contents or a match of its search', async () => {
  const dialog = await openPreview()
  await userEvent.click(await within(dialog).findByRole('button', { name: /^Schedule/ }))
  expect(await within(dialog).findByText('PDF page 5')).toBeInTheDocument()

  await userEvent.type(
    within(dialog).getByRole('searchbox', { name: 'Search this file' }),
    'midterm',
  )
  const hit = await within(dialog).findByRole('button', { name: /^Grading\s*p\. 3/ })
  expect(searches.at(-1)).toMatchObject({ query: 'midterm', item_ids: ['i1'] })
  await userEvent.click(hit)
  expect(await within(dialog).findByText('PDF page 3')).toBeInTheDocument()
})

test("a link in a PDF asks before leaving, like the course's other links", async () => {
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  const dialog = await openPreview()
  await userEvent.click(await within(dialog).findByRole('link', { name: 'notes 1' }))
  const leave = await screen.findByRole('alertdialog', { name: 'Open an external site?' })
  expect(leave).toHaveTextContent('https://example.com/notes/1')
  await userEvent.click(within(leave).getByRole('button', { name: 'Open' }))
  expect(open).toHaveBeenCalledWith('https://example.com/notes/1', '_blank', 'noopener,noreferrer')
  open.mockRestore()
})

test('a PDF can be read as the text Semestra recognized in it', async () => {
  const dialog = await openPreview()
  await userEvent.click(await within(dialog).findByRole('button', { name: 'Recognized text' }))
  expect(await within(dialog).findByText('Read from page one')).toBeInTheDocument()
})

test('earlier pages of the recognized text stay in view once loaded', async () => {
  server.use(
    http.get(`${API}/files/:id/document`, ({ request }) => {
      const url = new URL(request.url)
      const from = Number(url.searchParams.get('page_from'))
      const to = Math.min(Number(url.searchParams.get('page_to')), 40)
      return HttpResponse.json({
        item_id: 'i1',
        display_name: 'syllabus.pdf',
        page_count: 40,
        pages: Array.from({ length: to - from + 1 }, (_, n) => ({
          page_no: from + n,
          markdown: `Text of page ${from + n}`,
          ocr_used: false,
          citation_id: 'x',
        })),
        next_page: to < 40 ? to + 1 : null,
        citations: [],
      })
    }),
  )
  const scrolled: string[] = []
  const spy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (
    this: Element,
  ) {
    scrolled.push(this.getAttribute('data-page') ?? '')
  })
  function Reader() {
    const [target, setTarget] = useState(pageTarget(10))
    return (
      <DocumentText
        itemId="i1"
        target={target}
        terms={[]}
        onNavigate={(page) => setTarget(pageTarget(page))}
      />
    )
  }
  renderWithRouter(<Reader />)
  expect(await screen.findByText('Text of page 10')).toBeInTheDocument()
  await waitFor(() => expect(scrolled).toEqual(['10']))

  await userEvent.click(screen.getByRole('button', { name: 'Show earlier pages' }))
  expect(await screen.findByText('Text of page 1')).toBeInTheDocument()
  await waitFor(() => expect(scrolled.at(-1)).toBe('1'))
  expect(scrolled).toEqual(['10', '1'])
  spy.mockRestore()
})

test('the grid shows page images only for PDFs and images, and falls back to the icon', async () => {
  items.push(
    item({
      id: 'd1',
      display_name: 'notes.docx',
      original_name: 'notes.docx',
      mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      page_count: 3,
    }),
  )
  const { container } = mount()
  await userEvent.click(await screen.findByRole('button', { name: 'Grid' }))
  await screen.findAllByRole('button', { name: /notes\.docx/ })
  const images = () => [...container.querySelectorAll('img')].map((img) => img.src)
  expect(images()).toEqual([expect.stringContaining('/files/i1/pages/1.png')])
  // The grid has no column headers, so it gets a sort menu.
  expect(screen.getByRole('button', { name: 'Name' })).toBeInTheDocument()

  fireEvent.error(container.querySelector('img') as HTMLImageElement)
  expect(images()).toEqual([])
})

test('a long file list renders only the rows near the screen', async () => {
  items = Array.from({ length: 300 }, (_, n) =>
    item({ id: `f${n}`, display_name: `week-${String(n).padStart(3, '0')}.pdf` }),
  )
  mount()
  expect(await screen.findByRole('button', { name: 'week-000.pdf' })).toBeInTheDocument()
  const shown = screen.getAllByRole('button', { name: /^week-\d+\.pdf$/ }).length
  expect(shown).toBeGreaterThan(5)
  expect(shown).toBeLessThan(100)
})

function makeFolder(id: string, name: string, parent_id: string | null = null): FolderOut {
  return {
    item_count: 0,
    id,
    course_id: 'c1',
    parent_id,
    name,
    created_at: '2026-01-10T12:00:00Z',
    updated_at: '2026-01-10T12:00:00Z',
  }
}

test('a folder cannot move into itself, below itself, or deeper than three levels', () => {
  const folders = [
    makeFolder('a', 'A'),
    makeFolder('b', 'B', 'a'),
    makeFolder('c', 'C', 'b'),
    makeFolder('d', 'D'),
  ]
  const tree = folderTree(folders)
  const a: Target = { type: 'folder', folder: folders[0]! }
  const d: Target = { type: 'folder', folder: folders[3]! }
  const file: Target = { type: 'item', item: item({ folder_id: 'a' }) }
  expect(canMoveInto([a], 'a', tree)).toBe(false)
  expect(canMoveInto([a], 'b', tree)).toBe(false)
  expect(canMoveInto([a], 'd', tree)).toBe(false) // A › B › C would sit four deep
  expect(canMoveInto([d], 'b', tree)).toBe(true)
  expect(canMoveInto([d], 'c', tree)).toBe(false)
  // Already there: nothing to do, unless something else in the move is elsewhere.
  expect(canMoveInto([file], 'a', tree)).toBe(false)
  expect(canMoveInto([file, d], 'a', tree)).toBe(true)
  // A new folder in D would be at depth 2, too deep for A (height 3) but fine for files.
  expect(canMoveIntoNewFolder([a], 'd', tree)).toBe(false)
  expect(canMoveIntoNewFolder([file], 'd', tree)).toBe(true)
})

test('selected files move together to a folder picked in the tree', async () => {
  const moves: unknown[] = []
  server.use(
    http.get(`${API}/courses/c1/files`, () =>
      HttpResponse.json({
        folders: [makeFolder('f1', 'Week 1'), makeFolder('f2', 'Slides', 'f1')],
        items,
        next_cursor: null,
      }),
    ),
    http.post(`${API}/courses/c1/files\\:move`, async ({ request }) => {
      moves.push(await request.json())
      return HttpResponse.json({ moved: 2 })
    }),
  )
  const user = userEvent.setup()
  mount()
  await user.click(await screen.findByRole('checkbox', { name: 'Select syllabus.pdf' }))
  await user.click(screen.getByRole('checkbox', { name: 'Select Piazza' }))
  expect(screen.getByText('2 selected')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Move to…' }))

  const dialog = await screen.findByRole('dialog', { name: 'Move 2 items' })
  // Where they are now is not a destination.
  expect(within(dialog).getByRole('button', { name: 'All files' })).toBeDisabled()
  const here = within(dialog).getByRole('button', { name: 'Move here' })
  expect(here).toBeDisabled()
  await user.click(within(dialog).getByRole('button', { name: 'Slides' }))
  await user.click(here)

  // One request, so either both move or neither does.
  await waitFor(() =>
    expect(moves).toEqual([{ item_ids: ['i1', 'l1'], folder_ids: [], to_folder_id: 'f2' }]),
  )
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.queryByText('2 selected')).not.toBeInTheDocument()
})

test('chosen files and folders download together as one archive, links left out, or say why not', async () => {
  server.use(
    http.get(`${API}/courses/c1/files`, () =>
      HttpResponse.json({ folders: [makeFolder('f1', 'Labs')], items, next_cursor: null }),
    ),
  )
  const user = userEvent.setup()
  renderWithRouter(
    <>
      <CourseFilesPage scope={scope} />
      <Toaster />
    </>,
  )
  await user.click(await screen.findByRole('checkbox', { name: 'Select Piazza' }))
  // Only a link: nothing to download.
  expect(screen.queryByRole('button', { name: 'Download' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('checkbox', { name: 'Select syllabus.pdf' }))
  expect(screen.getByRole('button', { name: 'Download' })).toHaveAttribute(
    'href',
    `${API}/files/i1/content?disposition=attachment`,
  )
  await user.click(
    screen.getByRole('button', { name: 'Labs' }).closest('tr')!.querySelector('[role=checkbox]')!,
  )
  // More than one: an archive. The choice is posted first (so a refusal can be shown), then the
  // browser downloads the archive at the short address the server answered with.
  const saved: string[] = []
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    saved.push(this.href)
  })
  const asked: unknown[] = []
  server.use(
    http.post(`${API}/courses/c1/files:download`, async ({ request }) => {
      asked.push(await request.json())
      return HttpResponse.json({ download_id: 'd1' })
    }),
  )
  await user.click(screen.getByRole('button', { name: 'Download' }))
  await waitFor(() => expect(saved).toEqual([`${API}/file-downloads/d1`]))
  expect(asked).toEqual([{ item_ids: ['i1'], folder_ids: ['f1'] }])

  // None of them could be read: an error, nothing saved.
  server.use(
    http.post(`${API}/courses/c1/files:download`, () =>
      HttpResponse.json(
        { error: { code: 'files.download_unavailable', params: {}, request_id: 'r' } },
        { status: 502 },
      ),
    ),
  )
  await user.click(screen.getByRole('button', { name: 'Download' }))
  expect(
    await screen.findByText("The files couldn't be read from where they're kept. Try again later."),
  ).toBeInTheDocument()
  expect(saved).toEqual([`${API}/file-downloads/d1`])
})

const job = (status: string, step: string | null) => ({
  id: 'j1',
  kind: 'files.organize',
  status,
  progress: status === 'succeeded' ? 100 : 40,
  step,
  step_current: step ? 12 : null,
  step_total: step ? 26 : null,
  result: null,
  error_code: null,
  error_params: null,
  attempts: 1,
  max_attempts: 1,
  cancel_requested: false,
  created_at: '2026-01-10T12:00:00Z',
  started_at: '2026-01-10T12:00:00Z',
  finished_at: null,
})

test('organizing reads again when the last plan has nothing left to move', async () => {
  let started = 0
  server.use(
    http.get(`${API}/courses/c1/files\\:organize`, () =>
      HttpResponse.json(
        started
          ? { job: job('running', 'reading'), plan: null }
          : // The files of the last plan were all moved since.
            { job: null, plan: { moves: [], left: 4 } },
      ),
    ),
    http.post(`${API}/courses/c1/files\\:organize`, () => {
      started += 1
      return HttpResponse.json(job('running', 'reading'))
    }),
    http.get(`${API}/jobs/j1`, () => HttpResponse.json(job('running', 'reading'))),
  )
  const user = userEvent.setup()
  mount()
  await user.click(await screen.findByRole('button', { name: 'Organize' }))

  const dialog = await screen.findByRole('dialog', { name: 'Organize files' })
  expect(await within(dialog).findByText(/Reading files/)).toBeInTheDocument()
  expect(started).toBe(1)
  // It can go on while the user does something else.
  await user.click(within(dialog).getByRole('button', { name: 'Continue in background' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

test('a plan waiting for review moves only the files kept', async () => {
  items = [
    item({ id: 'a', display_name: 'Lecture 3.pdf' }),
    item({ id: 'b', display_name: 'scan_0031.pdf' }),
  ]
  const applied: unknown[] = []
  server.use(
    http.get(`${API}/courses/c1/files\\:organize`, () =>
      HttpResponse.json({
        job: null,
        plan: {
          moves: [
            {
              item_id: 'a',
              type: 'lectures',
              folder_id: null,
              folder_name: 'Lectures',
              new_folder: true,
              from_folder_id: null,
            },
            {
              item_id: 'b',
              type: 'exams',
              folder_id: null,
              folder_name: 'Past exams',
              new_folder: true,
              from_folder_id: null,
            },
          ],
          left: 3,
        },
      }),
    ),
    http.post(`${API}/courses/c1/files\\:organize-apply`, async ({ request }) => {
      applied.push(await request.json())
      return HttpResponse.json({ moved: 1 })
    }),
  )
  const user = userEvent.setup()
  mount()
  // The plan waits: the button opens it instead of starting again.
  await user.click(await screen.findByRole('button', { name: 'Organize' }))

  const dialog = await screen.findByRole('dialog', { name: 'Organize files' })
  expect(await within(dialog).findByRole('region', { name: 'Past exams' })).toBeInTheDocument()
  expect(within(dialog).getByText('3 other files stay where they are.')).toBeInTheDocument()
  await user.click(within(dialog).getByRole('checkbox', { name: 'Lecture 3.pdf' }))
  await user.click(within(dialog).getByRole('button', { name: 'Move files (1)' }))

  await waitFor(() => expect(applied).toEqual([{ item_ids: ['b'] }]))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

test('back, forward and up move between the folders shown, by button and by key', async () => {
  server.use(
    http.get(`${API}/courses/c1/files`, () =>
      HttpResponse.json({
        folders: [makeFolder('f1', 'Week 1'), makeFolder('f2', 'Slides', 'f1')],
        items: [],
        next_cursor: null,
      }),
    ),
  )
  const user = userEvent.setup()
  const { router } = mount()
  const back = await screen.findByRole('button', { name: 'Back' })
  const forward = screen.getByRole('button', { name: 'Forward' })
  const up = screen.getByRole('button', { name: 'Up one folder' })
  expect(back).toHaveAttribute('aria-disabled', 'true')
  expect(up).toHaveAttribute('aria-disabled', 'true')

  await user.click(screen.getByRole('button', { name: 'Week 1' }))
  await user.click(await screen.findByRole('button', { name: 'Slides' }))
  await waitFor(() => expect(router.state.location.search).toEqual({ folder: 'f2' }))

  await user.click(up)
  await waitFor(() => expect(router.state.location.search).toEqual({ folder: 'f1' }))
  await user.click(back)
  await waitFor(() => expect(router.state.location.search).toEqual({ folder: 'f2' }))
  expect(forward).not.toHaveAttribute('aria-disabled', 'true')
  await user.keyboard('{Alt>}{ArrowLeft}{/Alt}')
  await waitFor(() => expect(router.state.location.search).toEqual({ folder: 'f1' }))
  await user.click(forward)
  await waitFor(() => expect(router.state.location.search).toEqual({ folder: 'f2' }))
  await user.keyboard('{Alt>}{ArrowUp}{/Alt}')
  await waitFor(() => expect(router.state.location.search).toEqual({ folder: 'f1' }))
})

test('the back button follows the browser history, so the two never disagree', async () => {
  server.use(
    http.get(`${API}/courses/c1/files`, () =>
      HttpResponse.json({
        folders: [makeFolder('f1', 'Week 1'), makeFolder('f2', 'Slides', 'f1')],
        items: [],
        next_cursor: null,
      }),
    ),
  )
  const user = userEvent.setup()
  const { router } = mount()
  await user.click(await screen.findByRole('button', { name: 'Week 1' }))
  await user.click(await screen.findByRole('button', { name: 'Slides' }))
  act(() => router.history.back())
  await waitFor(() => expect(router.state.location.search).toEqual({ folder: 'f1' }))
  await user.click(screen.getByRole('button', { name: 'Back' }))
  await waitFor(() => expect(router.state.location.search).toEqual({}))
  expect(screen.getByRole('button', { name: 'Back' })).toHaveAttribute('aria-disabled', 'true')
})

test('going up clears a search so the folder it opens is what shows', async () => {
  server.use(
    http.get(`${API}/courses/c1/files`, () =>
      HttpResponse.json({
        folders: [makeFolder('f1', 'Week 1')],
        items: [],
        next_cursor: null,
      }),
    ),
  )
  const user = userEvent.setup()
  mount()
  await user.click(await screen.findByRole('button', { name: 'Week 1' }))
  const box = screen.getByRole('searchbox')
  await user.type(box, 'zzz')
  await user.click(screen.getByRole('button', { name: 'Up one folder' }))
  await waitFor(() => expect(box).toHaveValue(''))
})

test('the folder and the previewed file are in the address, so back and reload return there', async () => {
  items = [item({ folder_id: 'f2' })]
  server.use(
    http.get(`${API}/courses/c1/files`, () =>
      HttpResponse.json({
        folders: [makeFolder('f1', 'Week 1'), makeFolder('f2', 'Slides', 'f1')],
        items,
        next_cursor: null,
      }),
    ),
  )
  const user = userEvent.setup()
  const { router, container } = mount()
  await user.click(await screen.findByRole('button', { name: 'Week 1' }))
  await user.click(await screen.findByRole('button', { name: 'Slides' }))
  expect(router.state.location.search).toEqual({ folder: 'f2' })
  // The trail's items sit side by side in the list, separators between them.
  expect(container.querySelector('li li')).toBeNull()

  await user.click(await screen.findByRole('button', { name: 'syllabus.pdf' }))
  expect(await screen.findByText('PDF page 1')).toBeInTheDocument()
  expect(router.state.location.search).toEqual({ folder: 'f2', file: 'i1' })

  act(() => router.history.back())
  await waitFor(() => expect(screen.queryByText('PDF page 1')).not.toBeInTheDocument())
  act(() => router.history.back())
  expect(await screen.findByRole('button', { name: 'Slides' })).toBeInTheDocument()
  expect(router.state.location.search).toEqual({ folder: 'f1' })
})

test('a link opens the folder and file it names, and one that is gone goes up instead', async () => {
  items = [item({ folder_id: 'f1' })]
  server.use(
    http.get(`${API}/courses/c1/files`, () =>
      HttpResponse.json({ folders: [makeFolder('f1', 'Week 1')], items, next_cursor: null }),
    ),
  )
  const opened = renderWithRouter(<CourseFilesPage scope={scope} />, undefined, {
    path: '/',
    at: '/?folder=f1&file=i1',
  })
  expect(await screen.findByText('PDF page 1')).toBeInTheDocument()
  expect(screen.getAllByText('Week 1').length).toBeGreaterThan(0)
  opened.unmount()

  const gone = renderWithRouter(<CourseFilesPage scope={scope} />, undefined, {
    path: '/',
    at: '/?folder=gone&file=gone',
  })
  expect(await screen.findByRole('button', { name: 'Week 1' })).toBeInTheDocument()
  await waitFor(() => expect(gone.router.state.location.search).toEqual({}))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('on a term page the course opened is in the address too, and back to all courses leaves it', async () => {
  server.use(
    http.get(`${API}/programs/p1/courses`, () =>
      HttpResponse.json({
        items: [course({ id: 'c1', code: 'APS105H1', term_ids: ['t1'] })],
        next_cursor: null,
      }),
    ),
    http.get(`${API}/courses/c1/files`, () =>
      HttpResponse.json({ folders: [makeFolder('f1', 'Week 1')], items, next_cursor: null }),
    ),
  )
  const user = userEvent.setup()
  const { router } = renderWithRouter(
    <TermFilesPage scope={{ kind: 'term', programId: 'p1', termId: 't1' }} />,
    undefined,
    { path: '/', at: '/?course=c1&folder=f1' },
  )
  expect(await screen.findByText('Week 1')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'All courses' }))
  expect(await screen.findByRole('button', { name: /APS105H1/ })).toBeInTheDocument()
  expect(router.state.location.search).toEqual({})
})

test('closing a preview leaves no step behind: back goes where the page was before it', async () => {
  const user = userEvent.setup()
  const { router } = renderWithRouter(<CourseFilesPage scope={scope} />, undefined, {
    path: '/',
    at: '/?from=1',
  })
  await user.click(await screen.findByRole('button', { name: 'syllabus.pdf' }))
  expect(await screen.findByText('PDF page 1')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Close' }))
  await waitFor(() => expect(router.state.location.search).toEqual({ from: 1 }))
  // Closing went back a step, so the step before is the page as it was, not the preview again.
  expect(router.history.canGoBack()).toBe(false)

  // Opened from a link, the preview closes in place.
  act(() => router.history.push('/?file=i1'))
  expect(await screen.findByText('PDF page 1')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Close' }))
  await waitFor(() => expect(router.state.location.search).toEqual({}))
  expect(router.history.length).toBe(2)
  act(() => router.history.back())
  await waitFor(() => expect(router.state.location.search).toEqual({ from: 1 }))
})
