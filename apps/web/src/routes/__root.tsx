import type { QueryClient } from '@tanstack/react-query'
import { Outlet, createRootRouteWithContext } from '@tanstack/react-router'
import { LocaleProvider } from '@/app/locale'
import { ThemeProvider } from '@/app/theme'
import { AuthProvider } from '@/modules/auth/AuthProvider'
import { Toaster } from '@/ui/sonner'

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: () => (
    <ThemeProvider>
      <LocaleProvider>
        <AuthProvider>
          <Outlet />
          <Toaster />
        </AuthProvider>
      </LocaleProvider>
    </ThemeProvider>
  ),
})
