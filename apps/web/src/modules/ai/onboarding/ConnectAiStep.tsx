import { m } from '@/paraglide/messages'
import { Card, CardContent } from '@/ui/card'
import { ProviderForm } from '../settings/ProviderForm'

/** Optional onboarding step "Connect AI" (M06 §7); the host shows "Skip" under it. */
export default function ConnectAiStep({ onDone }: { onDone: () => void }) {
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground">{m.ai_onboarding_body()}</p>
      <Card>
        <CardContent>
          <ProviderForm onSaved={onDone} submitLabel={m.ai_onboarding_save()} />
        </CardContent>
      </Card>
    </div>
  )
}
