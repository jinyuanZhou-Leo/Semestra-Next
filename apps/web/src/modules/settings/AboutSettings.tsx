import { ExternalLink } from 'lucide-react'
import { formatDateTime } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { getLocale } from '@/paraglide/runtime'
import { SettingRow, SettingsGroup } from '@/app/settings'

export const REPOSITORY_URL = 'https://github.com/jinyuanZhou-Leo/Semestra-Next'
/** The public docs; self-hosted builds link there too. */
const DOCS_URL = import.meta.env.VITE_DOCS_URL ?? 'https://semestra.jyleo.cc/docs'

const LINK =
  'inline-flex items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline'

export default function AboutSettings() {
  return (
    <SettingsGroup>
      <SettingRow label={m.settings_about_version()} labelId="about-version">
        <span aria-labelledby="about-version" data-testid="app-version" className="text-sm">
          {SEMESTRA_VERSION}
        </span>
      </SettingRow>
      <SettingRow label={m.settings_about_build_time()} labelId="about-build">
        <time dateTime={SEMESTRA_BUILD_TIME} aria-labelledby="about-build" className="text-sm">
          {formatDateTime(SEMESTRA_BUILD_TIME)}
        </time>
      </SettingRow>
      <SettingRow
        label={m.settings_about_docs()}
        labelId="about-docs"
        description={m.settings_about_docs_note()}
      >
        <a
          href={`${DOCS_URL}/${getLocale() === 'zh-CN' ? 'zh' : 'en'}`}
          target="_blank"
          rel="noreferrer noopener"
          className={LINK}
        >
          {m.settings_about_docs_link()}
          <ExternalLink aria-hidden className="size-3.5" />
        </a>
      </SettingRow>
      <SettingRow
        label={m.settings_about_source()}
        labelId="about-source"
        description={m.settings_about_license_note()}
      >
        <a href={REPOSITORY_URL} target="_blank" rel="noreferrer noopener" className={LINK}>
          GitHub
          <ExternalLink aria-hidden className="size-3.5" />
        </a>
      </SettingRow>
    </SettingsGroup>
  )
}
