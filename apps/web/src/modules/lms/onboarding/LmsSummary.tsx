import {
  lmsProgramBindingGetOptions,
  settingsValueGetOptions,
} from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { School } from 'lucide-react'
import { SummaryIcon, SummaryRow } from '@/modules/academics/onboarding/StepFooter'
import { m } from '@/paraglide/messages'
import { useProviderName, useProviderUis } from '../providers'
import { MATERIALS } from '../queries'
import { LogoTile } from '../settings/ConnectionsSection'

/** The learning platform line of the onboarding summary: the Program's connection, and how
 * course materials come in (chosen on the same step). */
export default function LmsSummary({ programId }: { programId: string }) {
  const uis = useProviderUis()
  const bound = useQuery(lmsProgramBindingGetOptions({ path: { program_id: programId } })).data
    ?.connection
  const materials = useQuery(
    settingsValueGetOptions({ path: { namespace: MATERIALS }, query: { scope_type: 'account' } }),
  ).data?.values
  const provider = useProviderName(bound?.provider) ?? m.lms_name()
  const ui = bound ? uis.get(bound.provider) : undefined
  const how = !materials
    ? null
    : materials.sync === false
      ? m.lms_onboarding_summary_materials_off()
      : materials.store === 'local'
        ? m.settings_lms_materials_store_option_local()
        : m.settings_lms_materials_store_option_online({ provider })
  return (
    <SummaryRow
      media={ui ? <LogoTile logo={ui.logo} /> : <SummaryIcon icon={School} />}
      title={m.lms_onboarding_summary_title()}
      detail={bound ? [bound.display_name, how].filter(Boolean).join(' · ') : undefined}
      done={Boolean(bound)}
    />
  )
}
