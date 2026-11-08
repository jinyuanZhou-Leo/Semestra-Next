import type { TokenCreated } from '@semestra/api-client'
import {
  accountTokenCreateMutation,
  accountTokenListQueryKey,
} from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CircleCheck, ChevronRight, ExternalLink } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'
import { ChoiceControl, type ChoiceOption } from '@/app/settings/choice'
import { COLLAPSE } from '@/lib/collapse'
import { docsUrl } from '@/lib/docs'
import { errorMessage } from '@/lib/errors'
import { needsReauth, ReauthStep } from '@/modules/auth/components/ReauthStep'
import { m } from '@/paraglide/messages'
import { Alert, AlertDescription } from '@/ui/alert'
import { Button } from '@/ui/button'
import { CodeBlock, CodeBlockActions, CodeBlockContent, CodeBlockCopyButton } from '@/ui/code-block'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/ui/collapsible'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldSet,
  FieldTitle,
} from '@/ui/field'
import { RadioGroup, RadioGroupItem } from '@/ui/radio-group'
import {
  type ClientId,
  type ClientKind,
  MCP_CLIENTS,
  mcpSetup,
  type McpClient,
} from './mcp-clients'

const KIND_LABEL: Record<ClientKind, () => string> = {
  link: m.assistant_mcp_kind_link,
  command: m.assistant_mcp_kind_command,
  config: m.assistant_mcp_kind_config,
  manual: m.assistant_mcp_kind_manual,
}

const clientName = (client: McpClient) => client.name || m.assistant_mcp_client_other()

/** One copyable block of code. */
function Code({ value }: { value: string }) {
  return (
    <CodeBlock size="sm">
      <CodeBlockActions>
        <CodeBlockCopyButton value={value} />
      </CodeBlockActions>
      <CodeBlockContent wrap className="pr-10">
        {value}
      </CodeBlockContent>
    </CodeBlock>
  )
}

/** What to do in the client once the token exists: everything already carries it. */
function Finish({ client, url, token }: { client: McpClient; url: string; token: string }) {
  const name = clientName(client)
  const setup = mcpSetup(client.id, url, token)
  if (setup.kind === 'link') {
    return (
      <div className="space-y-3">
        <Button
          className="w-full"
          nativeButton={false}
          // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- the children label it
          render={<a href={setup.href} target="_blank" rel="noreferrer noopener" />}
        >
          {m.assistant_mcp_open_in({ client: name })}
          <ExternalLink aria-hidden />
        </Button>
        <p className="text-sm text-muted-foreground">
          {m.assistant_mcp_hint_link({ client: name })}
        </p>
        <Collapsible>
          <CollapsibleTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="group/trigger -ml-2 max-w-full justify-start font-normal aria-expanded:bg-transparent"
              />
            }
          >
            <ChevronRight
              aria-hidden
              className="text-muted-foreground transition-transform group-data-panel-open/trigger:rotate-90"
            />
            <span className="truncate">
              {m.assistant_mcp_manual_fallback({ file: setup.file })}
            </span>
          </CollapsibleTrigger>
          <CollapsibleContent className={COLLAPSE}>
            <div className="pt-2">
              <Code value={setup.text} />
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    )
  }
  if (setup.kind === 'command') {
    return (
      <div className="space-y-2">
        <p className="text-sm">{m.assistant_mcp_run_command()}</p>
        <Code value={setup.text} />
        <p className="text-sm text-muted-foreground">
          {m.assistant_mcp_hint_command({ client: name })}
        </p>
      </div>
    )
  }
  if (setup.kind === 'config') {
    const hint: Partial<Record<ClientId, () => string>> = {
      vscode: m.assistant_mcp_hint_vscode,
      'claude-desktop': m.assistant_mcp_hint_claude_desktop,
    }
    return (
      <div className="space-y-2">
        <p className="text-sm">{m.assistant_mcp_add_to_file({ file: setup.file })}</p>
        <Code value={setup.text} />
        <p className="text-sm text-muted-foreground">
          {hint[client.id]?.() ?? m.assistant_mcp_hint_restart({ client: name })}
        </p>
      </div>
    )
  }
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <p className="text-sm font-medium">{m.assistant_mcp_endpoint()}</p>
        <Code value={url} />
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-medium">{m.assistant_mcp_token()}</p>
        <Code value={token} />
      </div>
      <p className="text-sm text-muted-foreground">{m.assistant_mcp_hint_manual()}</p>
    </div>
  )
}

/**
 * Connects an MCP client in two steps (M12 §5): pick the client and what it may do, which creates
 * an API token named after it; then one link, command or config that already carries the token.
 */
export function ConnectClientDialog({
  open,
  onOpenChange,
  url,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  url: string
}) {
  const id = useId()
  const queryClient = useQueryClient()
  const [clientId, setClientId] = useState<ClientId | null>(null)
  const [scope, setScope] = useState<'read' | 'write'>('read')
  const [days, setDays] = useState('never')
  const [created, setCreated] = useState<TokenCreated | null>(null)
  const create = useMutation({
    ...accountTokenCreateMutation(),
    onSuccess: (token) => {
      setCreated(token)
      void queryClient.invalidateQueries({ queryKey: accountTokenListQueryKey() })
    },
  })
  const reauth = needsReauth(create.error)
  const client = MCP_CLIENTS.find((c) => c.id === clientId) ?? null

  const scopeItems: ChoiceOption<'read' | 'write'>[] = [
    { value: 'read', label: m.auth_account_tokens_scope_read() },
    { value: 'write', label: m.auth_account_tokens_scope_write() },
  ]
  const expiryItems: ChoiceOption<string>[] = [
    { value: 'never', label: m.auth_account_tokens_expiry_never() },
    ...[30, 90, 365].map((d) => ({
      value: String(d),
      label: m.auth_account_tokens_expiry_days({ days: d }),
    })),
  ]

  // Also sent again once the user confirms it's them.
  const save = () => {
    if (!client) return
    create.mutate({
      body: {
        name: client.id === 'other' ? m.assistant_mcp_token_other() : clientName(client),
        scopes: scope === 'write' ? ['read', 'write'] : ['read'],
        expires_in_days: days === 'never' ? null : Number(days),
      },
    })
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    save()
  }

  // Forgotten once the dialog has faded out, so the next one starts over.
  const reset = () => {
    setClientId(null)
    setScope('read')
    setDays('never')
    setCreated(null)
    create.reset()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!create.isPending) onOpenChange(next)
      }}
      onOpenChangeComplete={(next) => {
        if (!next) reset()
      }}
    >
      <DialogContent className="sm:max-w-xl">
        {created && client ? (
          <div
            key="finish"
            className="grid min-w-0 gap-4 animate-in fade-in-0 slide-in-from-right-2 duration-200 motion-reduce:animate-none"
          >
            <DialogHeader>
              <DialogTitle>
                {m.assistant_mcp_connect_title({ client: clientName(client) })}
              </DialogTitle>
              <DialogDescription className="sr-only">
                {m.assistant_mcp_connect_description()}
              </DialogDescription>
            </DialogHeader>
            <Alert>
              <CircleCheck aria-hidden />
              <AlertDescription>{m.assistant_mcp_created({ name: created.name })}</AlertDescription>
            </Alert>
            <Finish client={client} url={url} token={created.token} />
            <DialogFooter className="items-center sm:justify-between">
              <Button
                variant="link"
                size="sm"
                className="px-0"
                nativeButton={false}
                // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- the children label it
                render={<a href={docsUrl(client.docs)} target="_blank" rel="noreferrer noopener" />}
              >
                {m.assistant_mcp_client_docs()}
              </Button>
              <DialogClose render={<Button />}>{m.auth_account_tokens_done()}</DialogClose>
            </DialogFooter>
          </div>
        ) : (
          <form key="pick" onSubmit={submit} noValidate className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{m.assistant_mcp_setup()}</DialogTitle>
              <DialogDescription>{m.assistant_mcp_connect_description()}</DialogDescription>
            </DialogHeader>
            <FieldSet disabled={create.isPending} className="gap-4">
              <RadioGroup
                aria-label={m.assistant_mcp_client()}
                value={clientId}
                onValueChange={(next) => setClientId(next as ClientId)}
                className="grid grid-cols-2 gap-2 sm:grid-cols-3"
              >
                {MCP_CLIENTS.map((c) => (
                  <FieldLabel
                    key={c.id}
                    htmlFor={`${id}-${c.id}`}
                    className="transition-colors duration-200 motion-reduce:transition-none *:data-[slot=field]:p-3 has-data-checked:border-primary/60 has-data-checked:bg-primary/5"
                  >
                    <Field orientation="horizontal">
                      <FieldContent className="min-w-0">
                        <FieldTitle className="truncate">{clientName(c)}</FieldTitle>
                        <FieldDescription className="truncate text-xs">
                          {KIND_LABEL[c.kind]()}
                        </FieldDescription>
                      </FieldContent>
                      <RadioGroupItem value={c.id} id={`${id}-${c.id}`} />
                    </Field>
                  </FieldLabel>
                ))}
              </RadioGroup>
              <Field>
                <FieldLabel id={`${id}-scope`}>{m.auth_account_tokens_scope_label()}</FieldLabel>
                <ChoiceControl
                  labelId={`${id}-scope`}
                  value={scope}
                  onChange={setScope}
                  options={scopeItems}
                />
                <FieldDescription>
                  {scope === 'write'
                    ? m.assistant_mcp_scope_write_hint()
                    : m.assistant_mcp_scope_read_hint()}
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel id={`${id}-expiry`}>{m.auth_account_tokens_expiry_label()}</FieldLabel>
                <ChoiceControl
                  labelId={`${id}-expiry`}
                  value={days}
                  onChange={setDays}
                  options={expiryItems}
                />
              </Field>
              <ReauthStep error={create.error} onVerified={save} />
              <FieldError>{create.error && !reauth ? errorMessage(create.error) : null}</FieldError>
            </FieldSet>
            <DialogFooter>
              <DialogClose
                render={<Button type="button" variant="outline" disabled={create.isPending} />}
              >
                {m.common_cancel()}
              </DialogClose>
              <Button type="submit" disabled={!client || create.isPending || reauth}>
                {create.isPending ? m.common_saving() : m.assistant_mcp_create_continue()}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
