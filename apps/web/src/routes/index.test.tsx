import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest'
import '@/app/api'
import { Route } from './index'

const server = setupServer(
  http.get('http://localhost:8000/healthz', () => HttpResponse.json({ status: 'ok' })),
)
beforeAll(() => server.listen())
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

test('home page shows the API as connected', async () => {
  const Home = Route.options.component!
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Home />
    </QueryClientProvider>,
  )
  expect(await screen.findByText(/Connected/)).toBeInTheDocument()
})
