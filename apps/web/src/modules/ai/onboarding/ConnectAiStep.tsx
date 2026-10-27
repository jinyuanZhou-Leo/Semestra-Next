import { m } from '@/paraglide/messages'
import { Card, CardContent } from '@/ui/card'
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

/** Optional onboarding step "Connect AI" (M06 §7); the host shows "Skip" under it. */
export default function ConnectAiStep({ onDone }: { onDone: () => void }) {
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground">{m.ai_onboarding_body()}</p>
      <Card>
        <CardContent className="flex flex-col gap-4">
          <AddProviderFlow
            onSaved={onDone}
            submitLabel={m.ai_onboarding_save()}
            Header={StepHeader}
          />
        </CardContent>
      </Card>
    </div>
  )
}
