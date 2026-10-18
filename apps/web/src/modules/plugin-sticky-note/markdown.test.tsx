import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { Markdown, parseBlocks, toggleTask } from './markdown'

const label = (text: string) => `done: ${text}`

test('inline syntax renders bold, italic and safe links only', () => {
  render(
    <Markdown
      taskLabel={label}
      content={'**bold** and *italic* and [site](https://example.com) [bad](javascript:alert(1))'}
    />,
  )
  expect(screen.getByText('bold').tagName).toBe('STRONG')
  expect(screen.getByText('italic').tagName).toBe('EM')
  expect(screen.getByRole('link', { name: 'site' })).toHaveAttribute('href', 'https://example.com')
  // An unsafe link stays plain text.
  expect(screen.queryByRole('link', { name: 'bad' })).toBeNull()
  expect(screen.getByText(/\[bad\]\(javascript:alert\(1\)\)/)).toBeInTheDocument()
})

test('markup in a note is text, never elements', () => {
  const { container } = render(
    <Markdown taskLabel={label} content={'<img src=x onerror=alert(1)>'} />,
  )
  expect(container.querySelector('img')).toBeNull()
  expect(container).toHaveTextContent('<img src=x onerror=alert(1)>')
})

test('lines become bullets, tasks, paragraphs and gaps', () => {
  expect(
    parseBlocks('hello\n- one\n* two\n- [ ] todo\n- [x] done\n\nend').map((b) => b.kind),
  ).toEqual(['paragraph', 'bullet', 'bullet', 'task', 'task', 'gap', 'paragraph'])
})

test('toggling a task flips only that line', () => {
  const content = '- [ ] a\n- [x] b\ntext'
  expect(toggleTask(content, 0)).toBe('- [x] a\n- [x] b\ntext')
  expect(toggleTask(content, 1)).toBe('- [ ] a\n- [ ] b\ntext')
  expect(toggleTask(content, 2)).toBe(content)
  expect(toggleTask(content, 9)).toBe(content)
})

test('clicking a checkbox reports the new content', async () => {
  const onToggle = vi.fn<(content: string) => void>()
  render(<Markdown taskLabel={label} content={'- [ ] milk'} onToggleTask={onToggle} />)
  await userEvent.click(screen.getByRole('checkbox', { name: 'done: milk' }))
  expect(onToggle).toHaveBeenCalledWith('- [x] milk')
})

test('underscores inside words are left alone', () => {
  render(<Markdown taskLabel={label} content={'see my_file_name.txt'} />)
  expect(screen.getByText('see my_file_name.txt')).toBeInTheDocument()
})
