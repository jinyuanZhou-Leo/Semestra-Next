import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { SafeHtml } from './SafeHtml'

test("a marked image loads from the app and goes back to the platform's address if that fails", () => {
  const original = 'https://canvas.example/courses/9/files/77/preview'
  render(
    <SafeHtml
      html={`<img alt="Banner" data-lms-kind="file" data-lms-ref="77" src="${original}">`}
      imageSrc={({ ref }) => `/files/${ref}`}
    />,
  )
  const img = screen.getByRole<HTMLImageElement>('img', { name: 'Banner' })
  expect(img.getAttribute('src')).toBe('/files/77')
  fireEvent.error(img)
  expect(img.getAttribute('src')).toBe(original)
})

test('editor leftovers get their real structure in the simplified display only', () => {
  const html =
    '<p><span><strong>Grade Composition</strong></span></p><p>&nbsp;</p>' +
    '<p><strong>Late work gets 0.</strong></p>' +
    '<table><tbody><tr><td></td><td>&nbsp;</td></tr><tr><td>a</td><td>b</td></tr></tbody></table>' +
    '<table><tbody><tr><td><strong>Item</strong></td><td><strong>Weight</strong></td></tr>' +
    '<tr><td>Labs</td><td>20%</td></tr></tbody></table>'
  const { container, rerender } = render(<SafeHtml html={html} />)
  expect(screen.getByRole('heading', { name: 'Grade Composition' })).toBeTruthy()
  expect(screen.getAllByRole('columnheader').map((th) => th.textContent)).toEqual([
    'Item',
    'Weight',
  ])
  expect(screen.getAllByRole('heading')).toHaveLength(1) // a bold sentence stays a paragraph
  expect(container.querySelectorAll('thead')).toHaveLength(1) // a blank first row is no header
  expect(container.querySelectorAll('p')).toHaveLength(1)

  rerender(<SafeHtml html={html} original />)
  expect(screen.queryByRole('heading')).toBeNull()
  expect(screen.queryAllByRole('columnheader')).toHaveLength(0)
})
