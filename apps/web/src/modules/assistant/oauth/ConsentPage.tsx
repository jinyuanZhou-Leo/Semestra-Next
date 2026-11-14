import {
  accountAuthorizationApproveMutation,
  accountAuthorizationDenyMutation,
  accountAuthorizationGetOptions,
} from '@semestra/api-client/react-query'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowLeftRight, KeyRound, Link2Off } from 'lucide-react'
import { useId, useState } from 'react'
import { BrandLogo, BrandTile } from '@/components/BrandLogo'
import { errorCode, toastError } from '@/lib/errors'
import { AuthLayout } from '@/modules/auth/components/AuthLayout'
import { needsReauth, ReauthGate, useReauthRequired } from '@/modules/auth/components/ReauthGate'
import { SignOutDialog } from '@/modules/auth/components/SignOutDialog'
import { useUser } from '@/modules/auth/useAuth'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/ui/empty'
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from '@/ui/field'
import { RadioGroup, RadioGroupItem } from '@/ui/radio-group'
import { Spinner } from '@/ui/spinner'
import { clientOfToken } from '../settings/mcp-clients'

type Scope = 'read' | 'write'

/** The request is too old (10 minutes) or not one this server made: the app has to start over. */
const isExpired = (err: unknown) =>
  Boolean(err) && ['auth.authorization_expired', 'common.validation'].includes(errorCode(err))

function Expired() {
  return (
    <Empty className="p-0">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Link2Off aria-hidden />
        </EmptyMedia>
        <EmptyTitle>{m.assistant_oauth_expired_title()}</EmptyTitle>
        <EmptyDescription>{m.assistant_oauth_expired_description()}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" nativeButton={false} render={<Link to="/" />}>
          {m.assistant_oauth_open_app()}
        </Button>
      </EmptyContent>
    </Empty>
  )
}

/** The app's mark beside Semestra's. */
function Pair({ client }: { client: string }) {
  const logo = clientOfToken(client)?.logo
  return (
    <div className="flex items-center gap-3">
      <BrandTile className="size-11 rounded-xl">
        {logo ? (
          <BrandLogo src={logo} className="size-6" />
        ) : (
          <KeyRound aria-hidden className="size-5 text-muted-foreground" />
        )}
      </BrandTile>
      <ArrowLeftRight aria-hidden className="size-4 text-muted-foreground" />
      <img src="/icons/icon.svg" alt="" className="size-11 rounded-xl" />
    </div>
  )
}

/**
 * Where an app that signs in (ChatGPT, Claude) asks to connect (M12 §5.3): who is signed in,
 * what it may do, and where the answer goes back to. Allowing needs a recent sign-in, confirmed
 * in place; either answer sends the browser back to the app.
 */
export function ConsentPage({ request }: { request: string }) {
  const id = useId()
  const user = useUser()
  const details = useQuery({
    ...accountAuthorizationGetOptions({ query: { request } }),
    enabled: request !== '',
    staleTime: Infinity,
  })
  const [scope, setScope] = useState<Scope>('read')
  const [switching, setSwitching] = useState(false)
  // Back to the app; the page stays as it is until the browser has left.
  const leave = ({ redirect_url }: { redirect_url: string }) => window.location.assign(redirect_url)
  const approve = useMutation({
    ...accountAuthorizationApproveMutation(),
    onSuccess: leave,
    onError: (err) => {
      if (!needsReauth(err) && !isExpired(err)) toastError(err)
    },
  })
  const deny = useMutation({
    ...accountAuthorizationDenyMutation(),
    onSuccess: leave,
    onError: toastError,
  })
  const reauth = useReauthRequired(approve.error, details.isSuccess)

  const allow = () =>
    approve.mutate({
      body: { request, scopes: scope === 'write' ? ['read', 'write'] : ['read'] },
    })

  const busy = approve.isPending || deny.isPending || approve.isSuccess || deny.isSuccess
  const here = `${window.location.pathname}${window.location.search}`

  if (request === '' || isExpired(details.error) || isExpired(approve.error)) {
    return (
      <AuthLayout>
        <Expired />
      </AuthLayout>
    )
  }
  if (!details.data) {
    return (
      <AuthLayout>
        <output className="flex items-center justify-center gap-2 py-12 text-sm">
          <Spinner aria-hidden className="motion-reduce:animate-none" />
          <span className="text-muted-foreground">{m.common_loading()}</span>
        </output>
      </AuthLayout>
    )
  }

  const { client_name: client, redirect_host: host, local, scopes } = details.data
  const options = [
    {
      value: 'read' as const,
      title: m.auth_account_tokens_scope_read(),
      description: m.assistant_oauth_read_description(),
    },
    {
      value: 'write' as const,
      title: m.auth_account_tokens_scope_write(),
      description: m.assistant_oauth_write_description(),
    },
  ].filter((o) => scopes.includes(o.value))

  return (
    <AuthLayout>
      <div className="grid gap-6">
        <Pair client={client} />
        <div className="grid gap-1.5">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            {m.assistant_oauth_title({ client })}
          </h1>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-muted-foreground">
              {m.assistant_oauth_signed_in_as()}{' '}
              <span className="font-medium text-foreground">{user.email}</span>
            </span>
            <Button
              variant="link"
              size="sm"
              className="h-auto shrink-0 px-0"
              disabled={busy}
              onClick={() => setSwitching(true)}
            >
              {m.assistant_oauth_switch_account()}
            </Button>
          </div>
        </div>
        <ReauthGate error={approve.error} enabled={details.isSuccess} onVerified={allow}>
          <RadioGroup
            aria-label={m.auth_account_tokens_scope_label()}
            value={scope}
            onValueChange={(value) => setScope(value as Scope)}
            disabled={busy}
          >
            {options.map((o) => (
              <FieldLabel key={o.value} htmlFor={`${id}-${o.value}`}>
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldTitle>{o.title}</FieldTitle>
                    <FieldDescription>{o.description}</FieldDescription>
                  </FieldContent>
                  <RadioGroupItem value={o.value} id={`${id}-${o.value}`} />
                </Field>
              </FieldLabel>
            ))}
          </RadioGroup>
        </ReauthGate>
        <p className="text-xs text-muted-foreground">
          {local ? m.assistant_oauth_local() : m.assistant_oauth_return({ host })}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => deny.mutate({ body: { request } })}
          >
            {deny.isPending || deny.isSuccess ? <Spinner aria-hidden /> : null}
            {m.assistant_oauth_deny()}
          </Button>
          <Button disabled={busy || reauth} onClick={allow}>
            {approve.isPending || approve.isSuccess ? <Spinner aria-hidden /> : null}
            {m.assistant_oauth_allow()}
          </Button>
        </div>
      </div>
      <SignOutDialog
        open={switching}
        onOpenChange={setSwitching}
        to={`/login?redirect=${encodeURIComponent(here)}`}
      />
    </AuthLayout>
  )
}
