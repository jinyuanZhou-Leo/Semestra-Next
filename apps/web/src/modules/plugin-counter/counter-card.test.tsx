import { QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { newQueryClient } from '@/test-utils'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type { CardSize } from '@/app/extensions'
import CounterCard from './CounterCard'
import CounterHeaderActions from './CounterHeaderActions'
import { counterSettingsSchema } from './schema'

const queryClient = newQueryClient()
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
)

const scope = { kind: 'program', programId: 'p1' } as const

function card(settings: Record<string, unknown>, size: CardSize = 'm', instanceId = 'i1') {
  return (
    <CounterCard
      scope={scope}
      instanceId={instanceId}
      size={size}
      settings={counterSettingsSchema.parse(settings)}
    />
  )
}

test.each(['s', 'm'] as const)('size %s shows the value and both buttons', (size) => {
  render(card({ label: 'Pages', value: 4 }, size), { wrapper })
  expect(screen.getByRole('status', { name: 'Pages: 4' })).toHaveTextContent('4')
  expect(screen.getByRole('button', { name: 'Increase Pages' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Decrease Pages' })).toBeEnabled()
})

test('the ring is left out at the small size', () => {
  const { container, rerender } = render(card({ show_ring: true }, 'm'), { wrapper })
  expect(container.querySelector('svg circle')).not.toBeNull()
  rerender(card({ show_ring: true }, 's'))
  expect(container.querySelector('svg circle')).toBeNull()
})

test('plus and minus move by the step and stop at the range', async () => {
  render(card({ label: 'Cups', min: 0, max: 4, step: 2, value: 2 }), { wrapper })
  await userEvent.click(screen.getByRole('button', { name: 'Increase Cups' }))
  expect(screen.getByRole('status')).toHaveTextContent('4')
  expect(screen.getByRole('button', { name: 'Increase Cups' })).toBeDisabled()
  await userEvent.click(screen.getByRole('button', { name: 'Decrease Cups' }))
  await userEvent.click(screen.getByRole('button', { name: 'Decrease Cups' }))
  expect(screen.getByRole('status')).toHaveTextContent('0')
  expect(screen.getByRole('button', { name: 'Decrease Cups' })).toBeDisabled()
})

test('a card that never had a count starts at the initial value', () => {
  render(card({ min: 0, max: 10, initial: 3 }), { wrapper })
  expect(screen.getByRole('status')).toHaveTextContent('3')
})

test('reset asks first and then returns to the initial value', async () => {
  const settings = counterSettingsSchema.parse({ label: 'Pages', initial: 1, value: 7 })
  const props = { scope, instanceId: 'i1', size: 'm', settings } as const
  render(
    <>
      <CounterHeaderActions {...props} />
      <CounterCard {...props} />
    </>,
    { wrapper },
  )
  await userEvent.click(screen.getByRole('button', { name: 'Reset' }))
  expect(screen.getByRole('status')).toHaveTextContent('7')
  const dialog = await screen.findByRole('alertdialog')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Reset' }))
  await vi.waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  expect(screen.getByRole('status')).toHaveTextContent('1')
  // A press right after the reset counts from the reset value, not from the old count.
  await userEvent.click(screen.getByRole('button', { name: 'Increase Pages' }))
  expect(screen.getByRole('status')).toHaveTextContent('2')
})

test('two counters do not share their value', async () => {
  render(
    <>
      {card({ label: 'A', value: 1 }, 'm', 'a')}
      {card({ label: 'B', value: 1 }, 'm', 'b')}
    </>,
    { wrapper },
  )
  await userEvent.click(screen.getByRole('button', { name: 'Increase A' }))
  expect(screen.getByRole('status', { name: 'A: 2' })).toBeInTheDocument()
  expect(screen.getByRole('status', { name: 'B: 1' })).toBeInTheDocument()
})

test('settings are validated: the range, the step and the initial value', () => {
  expect(counterSettingsSchema.safeParse({ min: 5, max: 5 }).success).toBe(false)
  expect(counterSettingsSchema.safeParse({ step: 0 }).success).toBe(false)
  expect(counterSettingsSchema.safeParse({ initial: 11 }).success).toBe(false)
  expect(counterSettingsSchema.parse({})).toMatchObject({ min: 0, max: 10, step: 1, initial: 0 })
})
