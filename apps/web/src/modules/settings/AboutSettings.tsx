import { ExternalLink } from 'lucide-react'
import { formatDateTime } from '@/lib/format'
import { m } from '@/paraglide/messages'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
} from '@/ui/item'
import { Label } from '@/ui/label'

export const REPOSITORY_URL = 'https://github.com/jinyuanZhou-Leo/Semestra-Next'

export default function AboutSettings() {
  return (
    <ItemGroup className="gap-0 rounded-2xl border">
      <Item>
        <ItemContent className="min-w-0 basis-64">
          <ItemTitle>
            <Label id="about-version">{m.settings_about_version()}</Label>
          </ItemTitle>
        </ItemContent>
        <ItemActions>
          <span aria-labelledby="about-version" data-testid="app-version" className="text-sm">
            {SEMESTRA_VERSION}
          </span>
        </ItemActions>
      </Item>
      <ItemSeparator className="my-0" />
      <Item>
        <ItemContent className="min-w-0 basis-64">
          <ItemTitle>
            <Label id="about-build">{m.settings_about_build_time()}</Label>
          </ItemTitle>
        </ItemContent>
        <ItemActions>
          <time dateTime={SEMESTRA_BUILD_TIME} aria-labelledby="about-build" className="text-sm">
            {formatDateTime(SEMESTRA_BUILD_TIME)}
          </time>
        </ItemActions>
      </Item>
      <ItemSeparator className="my-0" />
      <Item>
        <ItemContent className="min-w-0 basis-64">
          <ItemTitle>
            <Label id="about-source">{m.settings_about_source()}</Label>
          </ItemTitle>
          <ItemDescription>{m.settings_about_license_note()}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <a
            href={REPOSITORY_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline"
          >
            GitHub
            <ExternalLink aria-hidden className="size-3.5" />
          </a>
        </ItemActions>
      </Item>
    </ItemGroup>
  )
}
