import { lmsProgramBindingGetOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { School } from 'lucide-react'
import { SummaryIcon, SummaryRow } from '@/modules/academics/onboarding/StepFooter'
import { m } from '@/paraglide/messages'
import { useProviderUis } from '../providers'
import { LogoTile } from '../settings/ConnectionsSection'

/** The learning platform line of the onboarding summary: the Program's connection. */
export default function LmsSummary({ programId }: { programId: string }) {
  const uis = useProviderUis()
  const bound = useQuery(lmsProgramBindingGetOptions({ path: { program_id: programId } })).data
    ?.connection
  const ui = bound ? uis.get(bound.provider) : undefined
  return (
    <SummaryRow
      media={ui ? <LogoTile logo={ui.logo} /> : <SummaryIcon icon={School} />}
      title={m.lms_onboarding_summary_title()}
      detail={bound?.display_name}
      done={Boolean(bound)}
    />
  )
}
