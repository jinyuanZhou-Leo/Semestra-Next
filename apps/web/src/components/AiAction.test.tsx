import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { AiAction } from './AiAction'

test('idle starts the task; running shows the stage, percent and a stop button', async () => {
  const start = vi.fn<() => void>()
  const stop = vi.fn<() => void>()
  const { rerender } = render(
    <AiAction state="idle" label="Fill from syllabus" onClick={start} onCancel={stop} />,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Fill from syllabus' }))
  expect(start).toHaveBeenCalledOnce()
  expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull()

  rerender(
    <AiAction
      state="running"
      label="Fill from syllabus"
      progress={42}
      stageLabel="Reading pages 3/12"
      variant="anchored"
      onClick={start}
      onCancel={stop}
    />, // fmt: skip
  )
  expect(screen.getByRole('status')).toHaveTextContent('Reading pages 3/12, 42%')
  expect(screen.getByRole('progressbar', { name: 'Reading pages 3/12, 42%' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Reading pages/ })).toBeDisabled()
  await userEvent.click(screen.getByRole('button', { name: 'Stop' }))
  expect(stop).toHaveBeenCalledOnce()

  rerender(<AiAction state="running" label="x" cancelling onCancel={stop} />)
  // Both the action and its stop button read "Stopping…", and neither can be pressed again.
  for (const button of screen.getAllByRole('button', { name: 'Stopping…' })) {
    expect(button).toBeDisabled()
  }
})

test('success shows briefly, then the action is ready again', () => {
  vi.useFakeTimers()
  try {
    const { rerender } = render(<AiAction state="running" label="Summarise" progress={90} />)
    rerender(<AiAction state="success" label="Summarise" variant="radial" />)
    expect(screen.getByRole('status')).toHaveTextContent('Done')
    act(() => vi.advanceTimersByTime(1_300))
    expect(screen.getByRole('status')).toHaveTextContent('Summarise')
  } finally {
    vi.useRealTimers()
  }
})

test('errors offer a retry and show the reason inline', async () => {
  const retry = vi.fn<() => void>()
  render(
    <AiAction
      state="error"
      label="Summarise"
      error="The file could not be read."
      onClick={retry}
    />,
  )
  expect(screen.getByText('The file could not be read.')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(retry).toHaveBeenCalledOnce()
})
