import { aiProviderListOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { SettingsGroup } from '@/app/settings'
import { StepFooter } from '@/modules/academics/onboarding/StepFooter'
import type { OnboardingStepProps } from '@/modules/academics/types'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Item, ItemContent, ItemMedia, ItemTitle } from '@/ui/item'
import { Skeleton } from '@/ui/skeleton'
import { providerLogo } from '../presets'
import { AddProviderFlow, type FlowHeader, LogoTile } from '../settings/ProviderForm'

function StepHeader({ title, description, logo }: FlowHeader) {
  return (
    <div className="flex items-center gap-3">
      {logo !== undefined ? <LogoTile logo={logo} /> : null}
      <div>
        <p className="font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}

/**
 * Onboarding step "Connect AI" (M06 §7), before the first term so its wizard can read syllabi:
 * the same "Add provider" as in settings; once one is connected (or coming back to the step),
 * the providers and "Continue".
 */
export default function ConnectAiStep({ nav }: OnboardingStepProps) {
  const providers = useQuery(aiProviderListOptions())
  if (!providers.data) return <Skeleton className="h-96 w-full rounded-2xl" />
  const connected = providers.data.items
  return (
    <>
      {connected.length > 0 ? (
        <SettingsGroup>
          {connected.map((provider) => (
            <Item key={provider.id}>
              <ItemMedia>
                <LogoTile logo={providerLogo(provider)} />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{provider.display_name}</ItemTitle>
              </ItemContent>
            </Item>
          ))}
        </SettingsGroup>
      ) : (
        <div className="flex flex-col gap-4 rounded-2xl border p-4">
          <AddProviderFlow
            onSaved={nav.next}
            submitLabel={m.ai_onboarding_save()}
            Header={StepHeader}
          />
        </div>
      )}
      <StepFooter onBack={nav.back} onSkip={connected.length > 0 ? undefined : nav.next}>
        {connected.length > 0 ? (
          <Button onClick={nav.next}>{m.academics_onboarding_continue()}</Button>
        ) : null}
      </StepFooter>
    </>
  )
}
