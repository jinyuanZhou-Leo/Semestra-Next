import { Suspense } from 'react'
import type { Scope, SettingsLevel } from '../extensions'
import { useSettingsSections } from '../registry'

/** All settings sections of one level, in order (M00 §4.4; M11 builds the settings pages). */
export function SettingsSections({ level, scope }: { level: SettingsLevel; scope?: Scope }) {
  const sections = useSettingsSections(level)
  return (
    <div className="space-y-8">
      {sections.map((section) => {
        const Section = section.component
        return (
          <section
            key={section.id}
            aria-labelledby={`settings-${section.id}`}
            className="space-y-3"
          >
            <h2 id={`settings-${section.id}`} className="font-heading text-lg font-medium">
              {section.title()}
            </h2>
            <Suspense fallback={null}>
              <Section scope={scope} />
            </Suspense>
          </section>
        )
      })}
    </div>
  )
}
