import { Bell } from 'lucide-react'
import { SummaryIcon, SummaryRow } from '@/modules/academics/onboarding/StepFooter'
import { m } from '@/paraglide/messages'
import { useDeviceState } from '../push'

/** The notifications line of the onboarding summary: whether this browser receives them. */
export default function NotificationsSummary() {
  const on = useDeviceState() === 'on'
  return (
    <SummaryRow
      media={<SummaryIcon icon={Bell} />}
      title={m.notifications_onboarding_summary_title()}
      detail={on ? m.notifications_onboarding_summary_on() : undefined}
      done={on}
    />
  )
}
