import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Suspense } from 'react'
import { expect, test } from 'vitest'
import { renderWithRouter } from '@/test-utils'
import type { Citation } from '../stream'
import { Markdown } from './Markdown'

const NONE = new Map<string, Citation>()

async function show(text: string, citations: ReadonlyMap<string, Citation> = NONE) {
  const view = renderWithRouter(
    <Suspense fallback={<p>loading</p>}>
      <div data-testid="answer">
        <Markdown text={text} citations={citations} />
      </div>
    </Suspense>,
  )
  // The renderer is its own chunk; the first test waits for it to load.
  const answer = await screen.findByTestId('answer', {}, { timeout: 10_000 })
  return { ...view, answer }
}

test('a citation marker becomes a numbered badge named after its source', async () => {
  const citations = new Map([['f1', { id: 'f1', title: 'Syllabus.pdf', snippet: 'Final 40%' }]])
  await show('The final is worth 40% [[cite:f1]].', citations)
  expect(await screen.findByRole('button', { name: 'Syllabus.pdf' })).toHaveTextContent('1')
})

test('a link to a page of the app stays in the app', async () => {
  await show('See [your grades](/courses/1).')
  await userEvent.click(await screen.findByRole('link', { name: 'your grades' }))
  // The test router knows only `/`, so arriving anywhere else shows its marker.
  expect(await screen.findByTestId('not-found')).toBeInTheDocument()
})

test('a web link opens in a new tab without a referrer', async () => {
  await show('Read [the docs](https://example.com/docs).')
  const link = await screen.findByRole('link', { name: 'the docs' })
  expect(link).toHaveAttribute('href', 'https://example.com/docs')
  expect(link).toHaveAttribute('target', '_blank')
  expect(link).toHaveAttribute('rel', 'noreferrer')
})

test('HTML in an answer shows as text and runs nothing', async () => {
  const { answer } = await show(
    'Hi <script>alert(1)</script> <img src=x onerror="alert(1)"> [x](javascript:alert(1))',
  )
  expect(answer.querySelector('script')).toBeNull()
  expect(answer.querySelector('[onerror]')).toBeNull()
  expect(answer.querySelector('img')).toBeNull()
  expect(answer.querySelector('a[href^="javascript"]')).toBeNull()
  expect(answer).toHaveTextContent('<img src=x')
})

test('a link the renderer refuses keeps its text, with no note in English', async () => {
  const { answer } = await show('Open [notes](notes.pdf) now.')
  expect(answer).toHaveTextContent('Open notes now.')
  expect(answer).not.toHaveTextContent('blocked')
})

test('only images from the app load; others become a link named by their description', async () => {
  const { answer } = await show('![chart](/api/files/1/raw) ![grades](https://evil.example/p.png)')
  expect(answer.querySelector('img[src="/api/files/1/raw"]')).not.toBeNull()
  expect(answer.querySelector('img[src^="https://evil"]')).toBeNull()
  expect(screen.getByRole('link', { name: 'grades' })).toHaveAttribute(
    'href',
    'https://evil.example/p.png',
  )
})
