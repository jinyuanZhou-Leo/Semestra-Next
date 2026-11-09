import type { Connection } from '@semestra/api-client'
import {
  lmsConnectionListOptions,
  lmsProgramBindingGetOptions,
  lmsProgramBindingSetMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link2 } from 'lucide-react'
import { useState } from 'react'
import { SettingsGroup } from '@/app/settings'
import { StepFooter } from '@/modules/academics/onboarding/StepFooter'
import type { OnboardingStepProps } from '@/modules/academics/types'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/ui/item'
import { Skeleton } from '@/ui/skeleton'
import { useOfferedProviders, useProviderUis } from '../providers'
import { invalidateLms } from '../queries'
import { AddConnectionDialog, ConnectionStatus, LogoTile } from '../settings/ConnectionsSection'

/**
 * Onboarding step "Connect a learning platform" (M09 §7.1), before the first term so its wizard
 * can import the courses: a connection of the user's (one from before, or a new one) becomes the
 * Program's. Coming back to the step shows the Program's connection.
 */
export default function ConnectLmsStep({ programId, nav }: OnboardingStepProps) {
  const queryClient = useQueryClient()
  const uis = useProviderUis()
  const { providers } = useOfferedProviders()
  const connections = useQuery(lmsConnectionListOptions())
  const binding = useQuery(lmsProgramBindingGetOptions({ path: { program_id: programId } }))
  const bind = useMutation({ ...lmsProgramBindingSetMutation(), onError: toastError })
  const [adding, setAdding] = useState<{ kind: string; key: number } | null>(null)

  const choose = async (connection: Connection) => {
    await bind.mutateAsync({
      path: { program_id: programId },
      body: { connection_id: connection.id },
    })
    await invalidateLms(queryClient)
    nav.next()
  }

  if (!connections.data || !binding.data) return <Skeleton className="h-40 w-full rounded-2xl" />
  const bound = binding.data.connection
  const unbound = connections.data.items.filter((c) => c.id !== bound?.id)
  const logo = (kind: string) => uis.get(kind)?.logo ?? Link2

  return (
    <>
      <SettingsGroup>
        {bound ? (
          <Item>
            <ItemMedia>
              <LogoTile logo={logo(bound.provider)} />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{bound.display_name}</ItemTitle>
            </ItemContent>
            <ItemActions>
              <ConnectionStatus connection={bound} />
            </ItemActions>
          </Item>
        ) : (
          [
            ...unbound.map((connection) => (
              <Item key={connection.id}>
                <ItemMedia>
                  <LogoTile logo={logo(connection.provider)} />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{connection.display_name}</ItemTitle>
                </ItemContent>
                <ItemActions>
                  <Button
                    size="sm"
                    disabled={bind.isPending}
                    onClick={() => void choose(connection).catch(() => undefined)}
                  >
                    {m.lms_onboarding_use()}
                  </Button>
                </ItemActions>
              </Item>
            )),
            ...providers.map((ui) => (
              <Item key={ui.kind}>
                <ItemMedia>
                  <LogoTile logo={ui.logo} />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{ui.label()}</ItemTitle>
                  {ui.description ? <ItemDescription>{ui.description()}</ItemDescription> : null}
                </ItemContent>
                <ItemActions>
                  <Button
                    size="sm"
                    variant={unbound.length > 0 ? 'outline' : 'default'}
                    onClick={() => setAdding({ kind: ui.kind, key: Date.now() })}
                  >
                    {m.lms_onboarding_connect()}
                  </Button>
                </ItemActions>
              </Item>
            )),
          ]
        )}
      </SettingsGroup>
      <AddConnectionDialog
        key={adding?.key}
        open={adding !== null}
        chosen={adding?.kind}
        onClose={() => setAdding(null)}
        onSaved={(connection) => void choose(connection).catch(() => undefined)}
      />
      <StepFooter onBack={nav.back} onSkip={bound ? undefined : nav.next}>
        {bound ? <Button onClick={nav.next}>{m.academics_onboarding_continue()}</Button> : null}
      </StepFooter>
    </>
  )
}
