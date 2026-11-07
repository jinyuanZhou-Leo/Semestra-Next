import { Suspense, createContext, use, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type {
  Scope,
  SettingsGroup,
  SettingsLevel,
  SettingsSectionContribution,
} from '../extensions'
import { cn } from '@/lib/utils'
import { useModules, useSettingsSections } from '../registry'
import { groupOf, isNavigable } from './groups'
import { NamespaceForm } from './NamespaceForm'
import { SaveIndicator, type SectionStatus, SectionStatusContext } from './status'

const SlotContext = createContext<HTMLElement | null>(null)
/**
 * Puts its children at the right end of the section's header, e.g. the "Add" button of the
 * section's table (the entry point for new entries sits above the table, not in its last row).
 */
export function SectionAction({ children }: { children: ReactNode }) {
  const slot = use(SlotContext)
  return slot ? createPortal(children, slot) : null
}

/** One section: title, description, save status and its content (M11 §5.1). */
export function SectionFrame({
  section,
  scope,
  hidden,
}: {
  section: SettingsSectionContribution
  scope?: Scope
  /** Kept rendered but out of sight (a section that does not match the settings search). */
  hidden?: boolean
}) {
  const [status, setStatus] = useState<SectionStatus>({ status: 'idle' })
  const headingId = `settings-${section.id}-title`
  const Custom = section.component
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  return (
    <section
      id={section.id}
      data-settings-section
      hidden={hidden}
      aria-labelledby={headingId}
      // A custom section that renders nothing (nothing to set on this server) is left out.
      className="scroll-mt-6 space-y-4 has-[>div:empty]:hidden"
    >
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2
            id={headingId}
            className={cn(
              'font-heading text-base font-medium',
              section.danger && 'text-destructive',
            )}
          >
            {section.title()}
          </h2>
          {section.description ? (
            <p className="text-sm text-muted-foreground">{section.description()}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          <SaveIndicator {...status} />
          <div ref={setSlot} className="flex items-center gap-2 empty:hidden" />
        </div>
      </header>
      <SlotContext value={slot}>
        <SectionStatusContext value={setStatus}>
          <div className="space-y-6">
            {section.namespace !== undefined ? (
              <NamespaceForm
                namespace={section.namespace}
                level={section.level}
                scope={scope}
                fields={section.fields}
              />
            ) : Custom ? (
              <Suspense fallback={null}>
                <Custom scope={scope} />
              </Suspense>
            ) : null}
          </div>
        </SectionStatusContext>
      </SlotContext>
    </section>
  )
}

/**
 * Sections of one level, stacked, optionally only those of one group (M00 §4.4, M11 §5.1).
 * The settings pages use the group filter; tests and embeds can render a whole level.
 */
export function SettingsSections({
  level,
  scope,
  group,
}: {
  level: SettingsLevel
  scope?: Scope
  group?: SettingsGroup
}) {
  const sections = useSettingsSections(level).filter(
    (section) => isNavigable(section) && (group === undefined || groupOf(section) === group),
  )
  return (
    <div className="space-y-8">
      {sections.map((section) => (
        <SectionFrame key={section.id} section={section} scope={scope} />
      ))}
    </div>
  )
}

/** The account-level sections of one plugin, for the plugin's own page (M10). */
export function PluginSettingsSections({ pluginId }: { pluginId: string }) {
  const sections = useModules()
    .flatMap((module) => module.settingsSections ?? [])
    .filter((section) => section.level === 'account' && section.pluginId === pluginId)
    .sort((a, b) => a.order - b.order)
  return (
    <div className="space-y-8">
      {sections.map((section) => (
        <SectionFrame key={section.id} section={section} />
      ))}
    </div>
  )
}
