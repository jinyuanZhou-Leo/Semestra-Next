import { CircleAlert, KeyRound, ScanSearch } from 'lucide-react'
import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { useSettingsDialog } from '@/app/settings/use-settings-dialog'
import { type AiBlock, type AiPurpose, useAiStatus } from '@/hooks/use-ai-status'
import { PROVIDER_ERROR_LABEL } from '@/modules/ai/labels'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/ui/item'

const UNSUPPORTED: Partial<Record<AiPurpose, () => string>> = {
  extraction: m.ai_gate_unsupported_extraction,
  vision: m.ai_gate_unsupported_vision,
}

const ICONS = { no_provider: KeyRound, unsupported: ScanSearch, provider_error: CircleAlert }

export type AiGateState = {
  block: AiBlock
  /**
   * Nothing can run until it is fixed. A provider's last reported problem is said but does not
   * stop anyone: it may have passed (a network blip), and the next call that works clears it.
   */
  blocking: boolean
  /** What is missing, as a heading ("Your current model can't read images"). */
  title: string
  /** The one-line form beside a button ("Available once a model provider is connected"). */
  line: string
  description: string
  action: string
  /** Opens the settings where it is fixed (that provider's edit dialog for its own problem). */
  fix: () => void
}

/**
 * Whether a feature that needs `purpose` can run, and if not why and where to fix it (M06 §7):
 * one place decides for every entry point. Null while it can run or the status is loading.
 */
export function useAiGate(purpose: AiPurpose): AiGateState | null {
  const { block, status } = useAiStatus(purpose)
  const settings = useSettingsDialog()
  if (!block) return null
  const providers = (item?: string) =>
    settings.open({ level: 'account', group: 'ai-providers', section: 'ai-providers', item })
  if (block === 'no_provider') {
    return {
      block,
      blocking: true,
      title: m.ai_gate_no_provider_title(),
      line: m.ai_gate_no_provider_line(),
      description: m.ai_gate_no_provider_description(),
      action: m.ai_gate_connect(),
      fix: () => providers(),
    }
  }
  if (block === 'unsupported') {
    const title = (UNSUPPORTED[purpose] ?? m.ai_gate_unsupported)()
    return {
      block,
      blocking: true,
      title,
      line: title,
      description: m.ai_gate_unsupported_description(),
      action: m.ai_gate_pick_model(),
      fix: () => settings.open({ level: 'account', group: 'ai-models', section: 'ai-models' }),
    }
  }
  return {
    block,
    blocking: false,
    ...providerProblem(status?.provider_name ?? '', status?.provider_error ?? ''),
    fix: () => providers(status?.provider_id ?? undefined),
  }
}

/** "DeepSeek: key rejected" with its way out, also for a task that failed for that reason. */
function providerProblem(provider: string, code: string) {
  const problem = (PROVIDER_ERROR_LABEL[code] ?? m.ai_provider_status_error)()
  const title = provider ? m.ai_gate_provider_error({ provider, problem }) : problem
  return {
    title,
    line: title,
    description: m.ai_gate_provider_error_description(),
    action: m.ai_gate_check_provider(),
  }
}

/**
 * A task for `purpose` that ended with `code`: when only the provider's settings can fix it (a
 * rejected key, no credit, unreachable), what to say and the way there; null for anything else.
 */
export function useProviderProblem(
  purpose: AiPurpose,
  code: string | null | undefined,
): { title: string; action: string; fix: () => void } | null {
  const { status } = useAiStatus(purpose)
  const settings = useSettingsDialog()
  if (!code || !(code in PROVIDER_ERROR_LABEL)) return null
  const { title, action } = providerProblem(status?.provider_name ?? '', code)
  return {
    title,
    action,
    fix: () =>
      settings.open({
        level: 'account',
        group: 'ai-providers',
        section: 'ai-providers',
        item: status?.provider_id ?? undefined,
      }),
  }
}

/**
 * An AI entry point outside a dialog (a settings row, a page's button). While the feature can't
 * run, the button stays visible but disabled and one plain line beside it says what is needed,
 * with a link to fix it: nothing hides in a hover. A function child renders the entry itself.
 */
export function AiRequired({
  purpose,
  children,
}: {
  purpose: AiPurpose
  children: ReactElement<{ disabled?: boolean }> | ((state: { available: boolean }) => ReactNode)
}) {
  const gate = useAiGate(purpose)
  const { pending } = useAiStatus(purpose)
  const available = !gate?.blocking && !pending
  const content =
    typeof children === 'function'
      ? children({ available })
      : isValidElement(children) && !available
        ? cloneElement(children, { disabled: true })
        : children
  if (!gate) return content
  return (
    <span className="inline-flex items-center gap-3">
      <span className="text-xs text-muted-foreground">
        {gate.line} ·{' '}
        <Button variant="link" className="h-auto p-0 text-xs" onClick={gate.fix}>
          {gate.action}
        </Button>
      </span>
      {content}
    </span>
  )
}

/**
 * The first step of an AI task in a dialog (an import): when the feature can't run, says why in
 * one row with its way out instead of the step, so nothing is picked or uploaded first. A
 * provider's last problem is the same row above the step, which stays usable. Without a
 * `purpose` (nothing to ask, or no longer) it is just its children.
 */
export function AiGate({ purpose, children }: { purpose?: AiPurpose; children: ReactNode }) {
  const found = useAiGate(purpose ?? 'extraction')
  const gate = purpose ? found : null
  const row = gate ? <GateRow gate={gate} /> : null
  if (gate?.blocking) return row
  // The same shape with or without the row, so the step keeps its state when the row goes.
  return (
    <>
      {row}
      {children}
    </>
  )
}

function GateRow({ gate }: { gate: AiGateState }) {
  const Icon = ICONS[gate.block]
  return (
    <Item variant="muted" className="rounded-2xl">
      <ItemMedia variant="icon">
        <Icon aria-hidden />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{gate.title}</ItemTitle>
        <ItemDescription>{gate.description}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button variant={gate.blocking ? 'default' : 'outline'} onClick={gate.fix}>
          {gate.action}
        </Button>
      </ItemActions>
    </Item>
  )
}
