import { ExternalLink } from 'lucide-react'
import { SettingList, SettingRow } from '@/components/SettingRow'
import { formatDateTime } from '@/lib/format'
import { m } from '@/paraglide/messages'

export const REPOSITORY_URL = 'https://github.com/jinyuanZhou-Leo/Semestra-Next'

export default function AboutSettings() {
  return (
    <SettingList>
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
        label={m.settings_about_source()}
        labelId="about-source"
        description={m.settings_about_license_note()}
      >
        <a
          href={REPOSITORY_URL}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline"
        >
          GitHub
          <ExternalLink aria-hidden className="size-3.5" />
        </a>
      </SettingRow>
    </SettingList>
  )
}
