import {
  settingsSchemaListOptions,
  settingsValueGetOptions,
  settingsValueGetQueryKey,
  settingsValueUpdateMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { NamespaceForm, SettingsGroup } from '@/app/settings'
import { fieldLabel, optionLabel } from '@/app/settings/texts'
import { COLLAPSE } from '@/lib/collapse'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Alert, AlertDescription, AlertTitle } from '@/ui/alert'
import { Button } from '@/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/ui/collapsible'
import { Skeleton } from '@/ui/skeleton'
import { Spinner } from '@/ui/spinner'
import { Switch } from '@/ui/switch'
import {
  CATEGORIES,
  type Category,
  NAMESPACE,
  hiddenExcept,
  isActive,
  offValue,
} from '../categories'
import { StepFooter } from '@/modules/academics/onboarding/StepFooter'
import type { OnboardingStepProps } from '@/modules/academics/types'
import { enableDevice, useDeviceState } from '../push'
import { NotificationPreview } from './NotificationPreview'

const ACCOUNT = { scope_type: 'account' } as const

/**
 * Onboarding step "Turn on notifications" (M18 §7): examples of what arrives, the three kinds
 * with their details one click away, and the button that asks the browser.
 */
export default function NotificationsStep({ nav }: OnboardingStepProps) {
  const state = useDeviceState()
  const [busy, setBusy] = useState(false)

  const turnOn = async () => {
    setBusy(true)
    let next = state
    try {
      next = await enableDevice()
    } catch (err) {
      toastError(err)
    }
    setBusy(false)
    if (next === 'on') nav.next()
  }

  const settled = state === 'on' || state === 'blocked' || state === 'install'
  return (
    <>
      <div className="space-y-6">
        <NotificationPreview />
        <Categories />
        {state === 'blocked' ? (
          <Alert>
            <TriangleAlert aria-hidden />
            <AlertTitle>{m.notifications_blocked_title()}</AlertTitle>
            <AlertDescription>{m.notifications_blocked_description()}</AlertDescription>
          </Alert>
        ) : null}
        {state === 'install' ? (
          <Alert>
            <AlertTitle>{m.notifications_install_title()}</AlertTitle>
            <AlertDescription>{m.notifications_install_description()}</AlertDescription>
          </Alert>
        ) : null}
      </div>
      <StepFooter onBack={nav.back} onSkip={settled ? undefined : nav.next}>
        {settled ? (
          <Button onClick={nav.next}>{m.academics_onboarding_continue()}</Button>
        ) : (
          <Button disabled={busy || state === 'checking'} onClick={() => void turnOn()}>
            {busy ? <Spinner /> : null}
            {m.notifications_turn_on()}
          </Button>
        )}
      </StepFooter>
    </>
  )
}

function Categories() {
  const schemas = useQuery({ ...settingsSchemaListOptions(), staleTime: Infinity })
  const values = useQuery(
    settingsValueGetOptions({ path: { namespace: NAMESPACE }, query: ACCOUNT }),
  )
  // Both are needed: turning a category back on restores the schema's defaults.
  if (!schemas.data || !values.data) {
    return (
      <SettingsGroup>
        {CATEGORIES.map((category) => (
          <div key={category.id} className="flex items-center gap-3 px-4 py-3">
            <Skeleton className="size-9 rounded-xl" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-48" />
            </div>
          </div>
        ))}
      </SettingsGroup>
    )
  }
  const definition = schemas.data.items.find((item) => item.namespace === NAMESPACE)
  const properties =
    (definition?.json_schema as { properties?: Record<string, { default?: unknown }> } | undefined)
      ?.properties ?? {}
  return (
    <SettingsGroup>
      {CATEGORIES.map((category) => (
        <CategoryRow
          key={category.id}
          category={category}
          values={values.data.values}
          defaults={Object.fromEntries(category.fields.map((f) => [f, properties[f]?.default]))}
        />
      ))}
    </SettingsGroup>
  )
}

/** What a category is set to, in place of a line explaining it: "Classes 10 minutes before · …". */
function summary(category: Category, values: Record<string, unknown>): string {
  const parts = category.fields
    .filter((field) => isActive(values[field]))
    .map((field) =>
      typeof values[field] === 'boolean'
        ? fieldLabel(NAMESPACE, field)
        : `${fieldLabel(NAMESPACE, field)} ${optionLabel(NAMESPACE, field, values[field])}`,
    )
  return parts.length ? parts.join(' · ') : m.notifications_category_off()
}

/** One kind of notification: a switch for all of it, and its own settings when expanded. */
function CategoryRow({
  category,
  values,
  defaults,
}: {
  category: Category
  values: Record<string, unknown>
  defaults: Record<string, unknown>
}) {
  const queryClient = useQueryClient()
  const update = useMutation({
    ...settingsValueUpdateMutation(),
    onSuccess: (result) =>
      queryClient.setQueryData(
        settingsValueGetQueryKey({ path: { namespace: NAMESPACE }, query: ACCOUNT }),
        result,
      ),
    onError: toastError,
  })
  const on = category.fields.some((field) => isActive(values[field]))
  const toggle = (checked: boolean) =>
    update.mutate({
      path: { namespace: NAMESPACE },
      body: {
        ...ACCOUNT,
        values: Object.fromEntries(
          category.fields.map((field) => [
            field,
            checked ? defaults[field] : offValue(values[field]),
          ]),
        ) as Record<string, never>,
      },
    })
  const Icon = category.icon
  const labelId = `notifications-category-${category.id}`
  return (
    <Collapsible className="group/category">
      <div className="flex items-center gap-3 pr-4">
        {/* The whole row opens the details; the switch beside it is its own control. */}
        <CollapsibleTrigger
          aria-label={m.notifications_category_details({ name: category.title() })}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-l-2xl py-3 pl-4 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted">
            <Icon aria-hidden className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p id={labelId} className="text-sm font-medium">
              {category.title()}
            </p>
            <p className="truncate text-sm text-muted-foreground">{summary(category, values)}</p>
          </div>
          <ChevronDown
            aria-hidden
            className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-open/category:rotate-180"
          />
        </CollapsibleTrigger>
        <Switch aria-labelledby={labelId} checked={on} onCheckedChange={toggle} />
      </div>
      <CollapsibleContent className={COLLAPSE}>
        <div className="border-t bg-muted/30 pl-12">
          <NamespaceForm
            namespace={NAMESPACE}
            level="account"
            fields={{ order: category.fields, hidden: hiddenExcept(category.fields) }}
            className=""
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
