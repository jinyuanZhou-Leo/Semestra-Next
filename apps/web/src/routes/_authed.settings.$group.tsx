import { createFileRoute } from '@tanstack/react-router'
import { SettingsPage } from '@/app/settings'
import { m } from '@/paraglide/messages'

export const Route = createFileRoute('/_authed/settings/$group')({ component: AccountSettings })

/** Account settings (M11 §5.2): `/settings/<group>`, with `#<section>` for a section. */
function AccountSettings() {
  const { group } = Route.useParams()
  return (
    <SettingsPage
      level="account"
      groupId={group}
      title={m.settings_title()}
      hrefFor={(id) => `/settings/${id}`}
      fallbackHref="/"
    />
  )
}
