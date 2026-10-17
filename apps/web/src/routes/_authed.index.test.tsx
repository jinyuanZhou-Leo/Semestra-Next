import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest'
import { AuthContext } from '@/modules/auth/useAuth'
import { API, renderWithRouter, server, user } from '@/test-utils'
import { Route } from './_authed.index'

beforeAll(() => server.listen())
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

test('home page shows the API as connected and who is signed in', async () => {
  server.use(http.get(`${API}/healthz`, () => HttpResponse.json({ status: 'ok' })))
  const Home = Route.options.component!
  renderWithRouter(
    <AuthContext.Provider value={{ user, isLoading: false, signOut: async () => {} }}>
      <Home />
    </AuthContext.Provider>,
  )
  expect(await screen.findByText(/Connected/)).toBeInTheDocument()
  expect(screen.getByTestId('signed-in-as')).toHaveTextContent('Signed in as Ada')
})
