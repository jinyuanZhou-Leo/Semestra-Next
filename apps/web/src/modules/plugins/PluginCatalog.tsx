import type { PluginOut } from '@semestra/api-client'
import { pluginsInstall, pluginsUninstall } from '@semestra/api-client'
import { pluginsCatalogListOptions } from '@semestra/api-client/react-query'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Blocks, Check, LayoutGrid, PanelTop, type LucideIcon } from 'lucide-react'
import { Fragment, useId, useState } from 'react'
import { toast } from 'sonner'
import { invalidateOperations } from '@/app/api'
import type { ModuleManifest } from '@/app/extensions'
import { useAllModules } from '@/app/registry'
import { PluginSettingsSections } from '@/app/settings'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { Checkbox } from '@/ui/checkbox'
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/ui/field'
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from '@/ui/item'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/ui/sheet'

/** What the user sees of a catalog entry: the frontend manifest when the module has one. */
type Entry = {
  plugin: PluginOut
  module: ModuleManifest | undefined
  name: string
  description: string
  icon: LucideIcon
}

function toEntry(plugin: PluginOut, modules: readonly ModuleManifest[]): Entry {
  const module = modules.find((mod) => mod.id === plugin.id)
  return {
    plugin,
    module,
    name: module?.name() ?? plugin.id,
    description: module?.description() ?? plugin.summary,
    icon: module?.icon ?? Blocks,
  }
}

/** Refetch everything that depends on which plugins are installed. */
function useRefreshInstalled() {
  const queryClient = useQueryClient()
  return () =>
    invalidateOperations(queryClient, [
      'pluginsCatalogList',
      'layoutsBoardGet',
      'layoutsCardSettingsGet',
    ])
}

function PluginTile({ entry, onOpen }: { entry: Entry; onOpen: () => void }) {
  const Icon = entry.icon
  return (
    <li>
      <Item
        variant="outline"
        render={(props) => (
          <button type="button" {...props}>
            {props.children}
          </button>
        )}
        onClick={onOpen}
        className="h-full flex-col items-stretch gap-2"
      >
        <span className="flex w-full items-center gap-2">
          <ItemMedia variant="icon" className="size-8 rounded-lg bg-muted">
            <Icon aria-hidden />
          </ItemMedia>
          <ItemTitle className="min-w-0 flex-1 truncate">{entry.name}</ItemTitle>
          {entry.plugin.installed ? (
            <Badge variant="secondary">
              <Check aria-hidden />
              {m.plugins_installed()}
            </Badge>
          ) : null}
        </span>
        <ItemDescription className="line-clamp-2">{entry.description}</ItemDescription>
        <ItemDescription className="mt-auto text-xs">
          {m.plugins_by({ author: entry.plugin.author })}
        </ItemDescription>
      </Item>
    </li>
  )
}

function ProvidesList({
  icon: Icon,
  title,
  items,
}: {
  icon: LucideIcon
  title: string
  items: readonly { id: string; title: string; description?: string }[]
}) {
  if (items.length === 0) return null
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
      <ItemGroup className="gap-1.5">
        {items.map((item) => (
          <Item key={item.id} render={<li />} size="xs" className="items-start px-0 py-0">
            <ItemMedia variant="icon" className="text-muted-foreground">
              <Icon aria-hidden />
            </ItemMedia>
            <ItemContent className="gap-0">
              <ItemTitle className="font-normal">{item.title}</ItemTitle>
              {item.description ? (
                <ItemDescription className="text-xs">{item.description}</ItemDescription>
              ) : null}
            </ItemContent>
          </Item>
        ))}
      </ItemGroup>
    </section>
  )
}

/** A plugin's page (M10 §5.3): what it adds, install or uninstall, and its own settings. */
function PluginDetails({ entry }: { entry: Entry }) {
  const refresh = useRefreshInstalled()
  const queryClient = useQueryClient()
  const purgeId = useId()
  const [pending, setPending] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [purge, setPurge] = useState(false)
  const { plugin, module } = entry
  const Icon = entry.icon

  const pages = (module?.pages ?? []).map((p) => ({ id: p.id, title: p.title() }))
  const cards = (module?.cards ?? []).map((c) => ({
    id: c.id,
    title: c.title(),
    description: c.description?.(),
  }))

  const install = async () => {
    setPending(true)
    try {
      await pluginsInstall({ path: { plugin_id: plugin.id }, throwOnError: true })
      await refresh()
      toast.success(m.plugins_installed_toast({ name: entry.name }))
    } catch (err) {
      toastError(err)
    } finally {
      setPending(false)
    }
  }

  const uninstall = async () => {
    setPending(true)
    try {
      await pluginsUninstall({
        path: { plugin_id: plugin.id },
        query: { purge_data: purge },
        throwOnError: true,
      })
      // Deleted data may include remembered UI state (a running timer): forget this tab's copy.
      if (purge) queryClient.removeQueries({ queryKey: ['ui-pref'] })
      await refresh()
      setConfirming(false)
      toast.success(m.plugins_uninstalled_toast({ name: entry.name }))
    } catch (err) {
      toastError(err)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <SheetHeader className="pr-12 text-left">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted">
            <Icon aria-hidden className="size-5" />
          </span>
          <div className="min-w-0 space-y-0.5">
            <SheetTitle className="font-heading text-base font-semibold">{entry.name}</SheetTitle>
            <SheetDescription className="text-xs">
              {m.plugins_version({ author: plugin.author, version: plugin.version })}
            </SheetDescription>
          </div>
        </div>
      </SheetHeader>
      <div className="flex flex-col gap-6 px-6 pb-6">
        <p className="text-sm">{entry.description}</p>
        {module?.requirements ? (
          <section className="space-y-1 rounded-lg bg-muted/60 p-3 text-sm">
            <h3 className="font-medium">{m.plugins_requirements()}</h3>
            <p className="text-muted-foreground">{module.requirements()}</p>
          </section>
        ) : null}
        <ProvidesList icon={PanelTop} title={m.plugins_provides_pages()} items={pages} />
        <ProvidesList icon={LayoutGrid} title={m.plugins_provides_cards()} items={cards} />
        <div>
          {plugin.installed ? (
            <Button variant="outline" disabled={pending} onClick={() => setConfirming(true)}>
              {m.plugins_uninstall()}
            </Button>
          ) : (
            <Button disabled={pending} onClick={install}>
              {pending ? m.common_loading() : m.plugins_install()}
            </Button>
          )}
        </div>
        {plugin.installed ? <PluginSettingsSections pluginId={plugin.id} /> : null}
        <ConfirmDialog
          open={confirming}
          onOpenChange={(open) => {
            setConfirming(open)
            if (!open) setPurge(false)
          }}
          title={m.plugins_uninstall_title({ name: entry.name })}
          description={m.plugins_uninstall_description()}
          extra={
            <Field orientation="horizontal" className="items-start">
              <Checkbox
                id={purgeId}
                checked={purge}
                onCheckedChange={(checked) => setPurge(checked)}
              />
              <FieldContent>
                <FieldLabel htmlFor={purgeId} className="font-normal">
                  {m.plugins_purge_label()}
                </FieldLabel>
                <FieldDescription>{m.plugins_purge_hint()}</FieldDescription>
              </FieldContent>
            </Field>
          }
          confirmLabel={purge ? m.plugins_uninstall_and_purge() : m.plugins_uninstall()}
          pending={pending}
          onConfirm={() => void uninstall()}
        />
      </div>
    </div>
  )
}

/**
 * The "Plugins" settings section (M10 §5.3): the plugins to install, and the core features,
 * which cannot be uninstalled but whose pages can be hidden.
 */
export default function PluginCatalog() {
  const { data } = useSuspenseQuery(pluginsCatalogListOptions())
  const modules = useAllModules()
  const [openId, setOpenId] = useState<string | null>(null)
  const entries = data.items.map((plugin) => toEntry(plugin, modules))
  const plugins = entries.filter((e) => e.plugin.kind === 'plugin')
  const core = entries.filter((e) => e.plugin.kind === 'core')
  const open = entries.find((e) => e.plugin.id === openId && e.plugin.kind === 'plugin')

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h3 className="font-heading text-sm font-medium">{m.plugins_available()}</h3>
        {plugins.length === 0 ? (
          <p className="text-sm text-muted-foreground">{m.plugins_none_available()}</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {plugins.map((entry) => (
              <PluginTile
                key={entry.plugin.id}
                entry={entry}
                onOpen={() => setOpenId(entry.plugin.id)}
              />
            ))}
          </ul>
        )}
      </section>
      <section className="space-y-3">
        <div>
          <h3 className="font-heading text-sm font-medium">{m.plugins_core_title()}</h3>
          <p className="text-sm text-muted-foreground">{m.plugins_core_note()}</p>
        </div>
        <ItemGroup className="gap-0 rounded-xl ring-1 ring-foreground/10">
          {core.map(({ plugin, name, description, icon: Icon }, index) => (
            <Fragment key={plugin.id}>
              {index > 0 ? <ItemSeparator className="my-0" /> : null}
              <Item render={<li />} size="sm">
                <ItemMedia variant="icon" className="text-muted-foreground">
                  <Icon aria-hidden />
                </ItemMedia>
                <ItemContent className="min-w-0 gap-0.5">
                  <ItemTitle>{name}</ItemTitle>
                  <ItemDescription className="line-clamp-1 text-xs">{description}</ItemDescription>
                </ItemContent>
              </Item>
            </Fragment>
          ))}
        </ItemGroup>
      </section>
      <Sheet open={open != null} onOpenChange={(next) => !next && setOpenId(null)}>
        <SheetContent side="right" className="w-full p-0 sm:max-w-md">
          {open ? <PluginDetails entry={open} /> : null}
        </SheetContent>
      </Sheet>
    </div>
  )
}
