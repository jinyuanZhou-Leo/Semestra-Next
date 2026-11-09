import { aiProviderListOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { SummaryIcon, SummaryRow } from '@/modules/academics/onboarding/StepFooter'
import { m } from '@/paraglide/messages'
import { providerLogo } from '../presets'
import { LogoTile } from '../settings/ProviderForm'

/** The AI line of the onboarding summary: the connected providers. */
export default function AiSummary() {
  const providers = useQuery(aiProviderListOptions()).data?.items ?? []
  const first = providers[0]
  return (
    <SummaryRow
      media={first ? <LogoTile logo={providerLogo(first)} /> : <SummaryIcon icon={Sparkles} />}
      title={m.ai_onboarding_summary_title()}
      detail={providers.map((p) => p.display_name).join(' · ') || undefined}
      done={providers.length > 0}
    />
  )
}
