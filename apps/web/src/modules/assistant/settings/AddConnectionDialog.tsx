import type { TokenCreated } from '@semestra/api-client'
import {
  accountTokenCreateMutation,
  accountTokenListQueryKey,
} from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, ExternalLink, KeyRound } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'
import { BrandLogo, BrandTile } from '@/components/BrandLogo'
import { ChoiceControl, type ChoiceOption } from '@/app/settings/choice'
import { COLLAPSE } from '@/lib/collapse'
import { docsUrl } from '@/lib/docs'
import { focusOnMount } from '@/lib/focus'
import { errorMessage } from '@/lib/errors'
import { needsReauth, ReauthStep } from '@/modules/auth/components/ReauthStep'
import { m } from '@/paraglide/messages'
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
import { Field, FieldDescription, FieldError, FieldLabel, FieldSet } from '@/ui/field'
import { Input } from '@/ui/input'
import { Item, ItemContent, ItemGroup, ItemMedia, ItemTitle } from '@/ui/item'
import { type ClientId, MCP_CLIENTS, mcpSetup, type McpClient } from './mcp-clients'

const clientName = (client: McpClient) => client.name || m.assistant_mcp_client_other()

/** A client's mark in the small rounded tile the provider and token tables use. */
export function ClientTile({ client }: { client: McpClient | undefined }) {
  return (
    <BrandTile>
      {client?.logo ? (
        <BrandLogo src={client.logo} />
      ) : (
        <KeyRound aria-hidden className="size-4 text-muted-foreground" />
      )}
    </BrandTile>
  )
}

function StepHeader({
  client,
  title,
  description,
}: {
  client?: McpClient
  title: string
  description: string
}) {
  return (
    <DialogHeader>
      <div className="flex items-center gap-3">
        {client ? <ClientTile client={client} /> : null}
        <DialogTitle>{title}</DialogTitle>
      </div>
      <DialogDescription>{description}</DialogDescription>
    </DialogHeader>
  )
}

/** Step one, laid out like the AI provider picker: every client, then any other client or script. */
function ClientPicker({ onPick }: { onPick: (client: McpClient) => void }) {
  return (
    <ItemGroup className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {MCP_CLIENTS.map((c) => (
        <Item
          key={c.id}
          variant="outline"
          // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- the Item's children label it
          render={<button type="button" />}
          size="sm"
          className="cursor-pointer flex-col items-start justify-start gap-3 text-left hover:bg-muted"
          onClick={() => onPick(c)}
        >
          <ItemMedia>
            {c.logo ? (
              <BrandLogo src={c.logo} className="size-6" />
            ) : (
              <KeyRound aria-hidden className="size-6 text-muted-foreground" />
            )}
          </ItemMedia>
          <ItemContent className="w-full">
            <ItemTitle>{clientName(c)}</ItemTitle>
          </ItemContent>
        </Item>
      ))}
    </ItemGroup>
  )
}

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
 * Adds a connection (M12 §5), in the steps the AI provider dialog uses: pick the client; choose
 * what it may do, which creates an API token named after it; then one link, command or config
 * that already carries the token. "Other client or script" is a plain API token with its own name.
 */
export function AddConnectionDialog({
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
  const [client, setClient] = useState<McpClient | null>(null)
  const [name, setName] = useState('')
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
  const named = client?.name === ''
  const tokenName = named ? name.trim() : (client?.name ?? '')

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
    if (!tokenName) return
    create.mutate({
      body: {
        name: tokenName,
        scopes: scope === 'write' ? ['read', 'write'] : ['read'],
        expires_in_days: days === 'never' ? null : Number(days),
      },
    })
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    save()
  }

  const back = () => {
    setClient(null)
    create.reset()
  }

  // Forgotten once the dialog has faded out, so the next one starts over.
  const reset = () => {
    setClient(null)
    setName('')
    setScope('read')
    setDays('never')
    setCreated(null)
    create.reset()
  }

  const step = created ? 'finish' : client ? 'form' : 'pick'

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
        <div
          key={step}
          className="grid min-w-0 gap-4 animate-in fade-in-0 duration-200 motion-reduce:animate-none"
        >
          {step === 'pick' ? (
            <>
              <StepHeader
                title={m.assistant_mcp_add_title()}
                description={m.assistant_mcp_add_description()}
              />
              <ClientPicker onPick={setClient} />
            </>
          ) : null}
          {step === 'form' && client ? (
            <form onSubmit={submit} noValidate className="grid gap-4">
              <StepHeader
                client={client}
                title={
                  named
                    ? m.auth_account_tokens_create()
                    : m.assistant_mcp_connect_title({ client: client.name })
                }
                description={
                  named
                    ? m.assistant_mcp_token_description()
                    : m.assistant_mcp_connect_description({ client: client.name })
                }
              />
              <FieldSet disabled={create.isPending} className="gap-4">
                {named ? (
                  <Field>
                    <FieldLabel htmlFor={`${id}-name`}>
                      {m.auth_account_tokens_name_label()}
                    </FieldLabel>
                    <Input
                      id={`${id}-name`}
                      placeholder={m.auth_account_tokens_name_placeholder()}
                      value={name}
                      maxLength={60}
                      ref={focusOnMount}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </Field>
                ) : null}
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
                  <FieldLabel id={`${id}-expiry`}>
                    {m.auth_account_tokens_expiry_label()}
                  </FieldLabel>
                  <ChoiceControl
                    labelId={`${id}-expiry`}
                    value={days}
                    onChange={setDays}
                    options={expiryItems}
                  />
                </Field>
                <ReauthStep error={create.error} onVerified={save} />
                <FieldError>
                  {create.error && !reauth ? errorMessage(create.error) : null}
                </FieldError>
              </FieldSet>
              <div className="flex items-center justify-between gap-2">
                <Button type="button" variant="ghost" disabled={create.isPending} onClick={back}>
                  {m.ai_provider_back()}
                </Button>
                <Button type="submit" disabled={!tokenName || create.isPending || reauth}>
                  {create.isPending ? m.common_saving() : m.auth_account_tokens_create()}
                </Button>
              </div>
            </form>
          ) : null}
          {step === 'finish' && created && client ? (
            <>
              <StepHeader
                client={client}
                title={
                  named
                    ? m.auth_account_tokens_created_title()
                    : m.assistant_mcp_connect_title({ client: client.name })
                }
                description={m.assistant_mcp_created({ name: created.name })}
              />
              <Finish client={client} url={url} token={created.token} />
              <DialogFooter className="items-center sm:justify-between">
                <Button
                  variant="link"
                  size="sm"
                  className="px-0"
                  nativeButton={false}
                  render={
                    // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- the children label it
                    <a href={docsUrl(client.docs)} target="_blank" rel="noreferrer noopener" />
                  }
                >
                  {m.assistant_mcp_client_docs()}
                </Button>
                <DialogClose render={<Button />}>{m.auth_account_tokens_done()}</DialogClose>
              </DialogFooter>
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
