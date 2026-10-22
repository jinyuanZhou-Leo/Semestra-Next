import { useQuery } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { formatDate, formatDateTime } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { getLocale } from '@/paraglide/runtime'
import { SettingRow, SettingsBlock, SettingsGroup } from '@/app/settings'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/ui/accordion'
import { compareVersions, loadRelease, releaseVersions } from './release-notes'
import { ReleaseNotes } from './ReleaseNotes'

export const REPOSITORY_URL = 'https://github.com/jinyuanZhou-Leo/Semestra-Next'
/** The public docs; self-hosted builds link there too. */
const DOCS_URL = import.meta.env.VITE_DOCS_URL ?? 'https://semestra.jyleo.cc/docs'

/** Versions listed under "Earlier versions"; the docs changelog has all of them. */
const EARLIER_VERSIONS = 5

const LINK =
  'inline-flex items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline'

export default function AboutSettings() {
  const versions = releaseVersions()
    .filter((v) => compareVersions(v, SEMESTRA_VERSION) <= 0)
    .slice(0, EARLIER_VERSIONS + 1)
  const { data: releases = [] } = useQuery({
    queryKey: ['release-notes', versions],
    queryFn: async () => {
      const loaded = await Promise.all(versions.map(loadRelease))
      return loaded.filter((release) => release !== undefined)
    },
    staleTime: Infinity,
  })
  const current = releases.find((release) => release.version === SEMESTRA_VERSION)
  const earlier = releases.filter((release) => release !== current).slice(0, EARLIER_VERSIONS)
  const docsUrl = `${DOCS_URL}/${getLocale() === 'zh-CN' ? 'zh' : 'en'}`

  return (
    <div className="space-y-6">
      <SettingsGroup>
        <SettingRow
          label={m.settings_about_version()}
          labelId="about-version"
          description={
            current ? m.settings_about_released({ date: formatDate(current.date) }) : undefined
          }
        >
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
          <a href={docsUrl} target="_blank" rel="noreferrer noopener" className={LINK}>
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

      {current ? (
        <SettingsBlock title={m.settings_about_this_version({ version: current.version })}>
          <ReleaseNotes release={current} className="rounded-2xl border p-4" />
        </SettingsBlock>
      ) : null}

      {earlier.length > 0 ? (
        <SettingsBlock
          title={m.settings_about_earlier()}
          action={
            <a
              href={`${docsUrl}/changelog`}
              target="_blank"
              rel="noreferrer noopener"
              className={LINK}
            >
              {m.settings_about_changelog()}
              <ExternalLink aria-hidden className="size-3.5" />
            </a>
          }
        >
          <Accordion>
            {earlier.map((release) => (
              <AccordionItem key={release.version} value={release.version}>
                <AccordionTrigger>
                  <span>
                    {release.version}
                    <span className="ml-2 font-normal text-muted-foreground">
                      {formatDate(release.date)}
                    </span>
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <ReleaseNotes release={release} />
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </SettingsBlock>
      ) : null}
    </div>
  )
}
