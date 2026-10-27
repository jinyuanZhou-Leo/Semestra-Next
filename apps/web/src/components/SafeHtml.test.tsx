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
