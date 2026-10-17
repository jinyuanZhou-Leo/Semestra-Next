import { healthzOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { m } from '@/paraglide/messages'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  const health = useQuery(healthzOptions())
  const status = health.isPending
    ? m.home_api_loading()
    : health.isError
      ? m.home_api_error()
      : m.home_api_ok()

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 p-8">
      <h1 className="text-4xl font-semibold tracking-tight">{m.home_title()}</h1>
      <p className="text-muted-foreground">{m.home_tagline()}</p>
      <p className="text-sm" data-testid="api-status">
        {m.home_api_status()}: {status}
      </p>
    </main>
  )
}
