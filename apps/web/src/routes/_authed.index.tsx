import { healthzOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useAuth } from '@/modules/auth/useAuth'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'

export const Route = createFileRoute('/_authed/')({ component: Home })

function Home() {
  const health = useQuery(healthzOptions())
  const { user, signOut } = useAuth()
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
      {user ? (
        <p className="text-sm" data-testid="signed-in-as">
          {m.home_signed_in_as({ name: user.display_name })}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button variant="outline" render={<Link to="/settings" />}>
          {m.settings_title()}
        </Button>
        <Button variant="ghost" onClick={() => void signOut()}>
          {m.home_sign_out()}
        </Button>
      </div>
    </main>
  )
}
