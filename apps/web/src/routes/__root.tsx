import type { QueryClient } from '@tanstack/react-query'
import { Outlet, createRootRouteWithContext } from '@tanstack/react-router'
import { NavigationProgress } from '@/app/host/NavigationProgress'
import { LocaleProvider } from '@/app/locale'
import { ThemeProvider } from '@/app/theme'
import { AuthProvider } from '@/modules/auth/AuthProvider'
import { Toaster } from '@/ui/sonner'
import { TooltipProvider } from '@/ui/tooltip'

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: () => (
    <ThemeProvider>
      <LocaleProvider>
        <AuthProvider>
          <NavigationProgress />
          <TooltipProvider>
            <Outlet />
          </TooltipProvider>
          <Toaster />
        </AuthProvider>
      </LocaleProvider>
    </ThemeProvider>
  ),
})
