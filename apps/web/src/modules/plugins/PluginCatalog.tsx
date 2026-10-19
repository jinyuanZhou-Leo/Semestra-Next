import type { PluginOut } from '@semestra/api-client'
import { pluginsInstall, pluginsUninstall } from '@semestra/api-client'
import { pluginsCatalogListOptions } from '@semestra/api-client/react-query'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import {
  Blocks,
  Check,
  ChevronDown,
  Download,
  Info,
  LayoutGrid,
  PanelTop,
  Search,
  SearchX,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import { useId, useState } from 'react'
import { toast } from 'sonner'
import { invalidateOperations } from '@/app/api'
import type { ModuleManifest } from '@/app/extensions'
import { useAllModules } from '@/app/registry'
import { PluginSettingsSections, SettingsBlock, SettingsGroup } from '@/app/settings'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Checkbox } from '@/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/ui/empty'
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/ui/field'
import { Input } from '@/ui/input'
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/ui/item'
import { Separator } from '@/ui/separator'
import { Spinner } from '@/ui/spinner'
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group'

/** What the user sees of a catalog entry: the frontend manifest when the module has one. */
type Entry = {
  plugin: PluginOut
  module: ModuleManifest | undefined
  name: string
  description: string
  icon: LucideIcon
}

type Show = 'all' | 'installed'

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

function matches(entry: Entry, query: string): boolean {
  if (!query) return true
  const haystack = `${entry.name} ${entry.description} ${entry.plugin.id}`.toLocaleLowerCase()
  return haystack.includes(query)
}

/** Install or uninstall, then refetch everything that depends on which plugins are installed. */
function usePluginActions() {
  const queryClient = useQueryClient()
  const [pending, setPending] = useState<readonly string[]>([])
  const start = (id: string) => setPending((ids) => [...ids, id])
  const finish = (id: string) => setPending((ids) => ids.filter((other) => other !== id))
  const refresh = () =>
    invalidateOperations(queryClient, [
      'pluginsCatalogList',
      'layoutsBoardGet',
      'layoutsCardSettingsGet',
    ])

  const install = async (entry: Entry) => {
    const id = entry.plugin.id
    start(id)
    try {
      await pluginsInstall({ path: { plugin_id: id }, throwOnError: true })
      await refresh()
      toast.success(m.plugins_installed_toast({ name: entry.name }))
    } catch (err) {
      toastError(err)
    }
    finish(id)
  }

  /** Resolves to whether the plugin was uninstalled. */
  const uninstall = async (entry: Entry, purge: boolean) => {
    const id = entry.plugin.id
    start(id)
    let done = false
    try {
      await pluginsUninstall({
        path: { plugin_id: id },
        query: { purge_data: purge },
        throwOnError: true,
      })
      // Deleted data may include remembered UI state (a running timer): forget this tab's copy.
      if (purge) queryClient.removeQueries({ queryKey: ['ui-pref'] })
      await refresh()
      toast.success(m.plugins_uninstalled_toast({ name: entry.name }))
      done = true
    } catch (err) {
      toastError(err)
    }
    finish(id)
    return done
  }

  return { pending, install, uninstall }
}

type ActionProps = {
  entry: Entry
  /** An install or uninstall of this plugin is running: its controls stay off until it ends. */
  pending: boolean
  onInstall: () => void
  onUninstall: () => void
  /** Adds "Details" to the installed menu (on the card; the details dialog leaves it out). */
  onOpen?: () => void
}

/**
 * "Install", or "Installed ✓" opening a menu with the details and "Uninstall". While a change
 * runs, a spinner takes the place of the leading icon so the button keeps its width.
 */
function InstallButton({ entry, pending, onInstall, onUninstall, onOpen }: ActionProps) {
  if (!entry.plugin.installed) {
    return (
      <Button size="sm" disabled={pending} onClick={onInstall}>
        {pending ? <Spinner aria-label={m.common_loading()} /> : <Download aria-hidden />}
        {m.plugins_install()}
      </Button>
    )
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button size="sm" variant="secondary" disabled={pending} />}
        aria-label={m.plugins_installed_menu({ name: entry.name })}
      >
        {pending ? <Spinner aria-label={m.common_loading()} /> : <Check aria-hidden />}
        {m.plugins_installed()}
        <ChevronDown aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        {onOpen ? (
          <>
            <DropdownMenuItem onClick={onOpen}>
              <Info aria-hidden />
              {m.plugins_details()}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuItem variant="destructive" onClick={onUninstall}>
          <Trash2 aria-hidden />
          {m.plugins_uninstall()}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function PluginIcon({ icon: Icon, large }: { icon: LucideIcon; large?: boolean }) {
  return (
    <span
      className={
        large
          ? 'flex size-12 shrink-0 items-center justify-center rounded-2xl bg-muted'
          : 'flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted'
      }
    >
      <Icon aria-hidden className={large ? 'size-6' : 'size-5'} />
    </span>
  )
}

/**
 * A marketplace card. The whole card opens the details (the name's button stretches over it);
 * the install control sits above that overlay so it works on its own.
 */
function PluginCard(props: ActionProps & { onOpen: () => void }) {
  const { entry, onOpen } = props
  return (
    <Item
      variant="outline"
      render={<li />}
      className="relative h-full min-w-0 flex-col flex-nowrap items-stretch gap-3 p-4 transition-colors hover:bg-muted/50"
    >
      <div className="flex items-start gap-3">
        <PluginIcon icon={entry.icon} />
        <ItemContent className="min-w-0 gap-0.5">
          <ItemTitle className="w-full">
            <button
              type="button"
              onClick={onOpen}
              className="max-w-full min-w-0 truncate text-left outline-none after:absolute after:inset-0 after:rounded-[inherit] focus-visible:after:ring-3 focus-visible:after:ring-ring/50"
            >
              {entry.name}
            </button>
          </ItemTitle>
          <ItemDescription className="truncate text-xs">
            {m.plugins_by({ author: entry.plugin.author })}
          </ItemDescription>
        </ItemContent>
      </div>
      <ItemDescription className="line-clamp-2 min-h-10">{entry.description}</ItemDescription>
      <div className="relative mt-auto flex justify-end">
        <InstallButton {...props} />
      </div>
    </Item>
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
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
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

/** A plugin's details (M10 §5.3): what it adds, install or uninstall, and its own settings. */
function PluginDetails(props: ActionProps) {
  const { entry } = props
  const { plugin, module } = entry
  const pages = (module?.pages ?? []).map((p) => ({ id: p.id, title: p.title() }))
  const cards = (module?.cards ?? []).map((c) => ({
    id: c.id,
    title: c.title(),
    description: c.description?.(),
  }))
  const hasSettings = useAllModules().some((mod) =>
    (mod.settingsSections ?? []).some((s) => s.level === 'account' && s.pluginId === plugin.id),
  )

  return (
    <>
      <DialogHeader className="pr-10">
        <div className="flex items-center gap-3">
          <PluginIcon icon={entry.icon} large />
          <div className="min-w-0 flex-1 space-y-0.5">
            <DialogTitle className="truncate">{entry.name}</DialogTitle>
            <DialogDescription className="text-xs">
              {m.plugins_version({ author: plugin.author, version: plugin.version })}
            </DialogDescription>
          </div>
          <InstallButton {...props} />
        </div>
      </DialogHeader>
      <div className="-mx-6 flex min-h-0 flex-col gap-6 overflow-y-auto px-6 pb-1">
        <p className="text-sm">{entry.description}</p>
        {module?.requirements ? (
          <section className="space-y-1 rounded-lg bg-muted/60 p-3 text-sm">
            <h3 className="font-medium">{m.plugins_requirements()}</h3>
            <p className="text-muted-foreground">{module.requirements()}</p>
          </section>
        ) : null}
        <ProvidesList icon={PanelTop} title={m.plugins_provides_pages()} items={pages} />
        <ProvidesList icon={LayoutGrid} title={m.plugins_provides_cards()} items={cards} />
        {plugin.installed && hasSettings ? (
          <>
            <Separator />
            <PluginSettingsSections pluginId={plugin.id} />
          </>
        ) : null}
      </div>
    </>
  )
}

/**
 * The "Plugins" settings section (M10 §5.3): a marketplace grid of plugins to install or
 * uninstall, and the core features, which cannot be uninstalled but whose pages can be hidden.
 */
export default function PluginCatalog() {
  const { data } = useSuspenseQuery(pluginsCatalogListOptions())
  const modules = useAllModules()
  const purgeId = useId()
  const { pending, install, uninstall } = usePluginActions()
  const [search, setSearch] = useState('')
  const [show, setShow] = useState<Show>('all')
  const [openId, setOpenId] = useState<string | null>(null)
  // The entry stays after the confirmation closes so its title doesn't blank while it fades out.
  const [removing, setRemoving] = useState<Entry | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [purge, setPurge] = useState(false)

  const entries = data.items.map((plugin) => toEntry(plugin, modules))
  const query = search.trim().toLocaleLowerCase()
  const plugins = entries.filter((e) => e.plugin.kind === 'plugin')
  const visible = plugins.filter((e) => matches(e, query) && (show === 'all' || e.plugin.installed))
  const core = entries.filter((e) => e.plugin.kind === 'core' && matches(e, query))
  const open = plugins.find((e) => e.plugin.id === openId)
  const filtered = query !== '' || show !== 'all'
  // "Installed" with nothing installed is a state of the account, not a search without results.
  const noneInstalled =
    show === 'installed' && query === '' && !plugins.some((e) => e.plugin.installed)
  const removingPending = removing != null && pending.includes(removing.plugin.id)

  const actionsFor = (entry: Entry): ActionProps => ({
    entry,
    pending: pending.includes(entry.plugin.id),
    onInstall: () => void install(entry),
    onUninstall: () => {
      setRemoving(entry)
      setPurge(false)
      setConfirming(true)
    },
  })

  return (
    <div className="space-y-8">
      {/* The section above already says "Plugins": the marketplace goes without a heading. */}
      <section aria-label={m.plugins_available()} className="@container space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              aria-label={m.plugins_search()}
              placeholder={m.plugins_search()}
              className="pl-9"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <ToggleGroup
            aria-label={m.plugins_filter_label()}
            value={[show]}
            onValueChange={(next) => {
              if (next[0]) setShow(next[0] as Show)
            }}
            variant="outline"
          >
            <ToggleGroupItem value="all">{m.plugins_filter_all()}</ToggleGroupItem>
            <ToggleGroupItem value="installed">{m.plugins_installed()}</ToggleGroupItem>
          </ToggleGroup>
        </div>
        {visible.length > 0 ? (
          <ul className="grid gap-3 @lg:grid-cols-2 @3xl:grid-cols-3">
            {visible.map((entry) => (
              <PluginCard
                key={entry.plugin.id}
                {...actionsFor(entry)}
                onOpen={() => setOpenId(entry.plugin.id)}
              />
            ))}
          </ul>
        ) : plugins.length === 0 ? (
          <Empty className="border-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Blocks aria-hidden />
              </EmptyMedia>
              <EmptyTitle>{m.plugins_none_available()}</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : noneInstalled ? (
          <Empty className="border-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Blocks aria-hidden />
              </EmptyMedia>
              <EmptyTitle>{m.plugins_none_installed()}</EmptyTitle>
              <EmptyDescription>{m.plugins_none_installed_hint()}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={() => setShow('all')}>{m.plugins_browse_all()}</Button>
            </EmptyContent>
          </Empty>
        ) : filtered ? (
          <Empty className="border-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchX aria-hidden />
              </EmptyMedia>
              <EmptyTitle>{m.plugins_no_match()}</EmptyTitle>
            </EmptyHeader>
            <EmptyContent>
              <Button
                variant="outline"
                onClick={() => {
                  setSearch('')
                  setShow('all')
                }}
              >
                {m.common_clear_filters()}
              </Button>
            </EmptyContent>
          </Empty>
        ) : null}
      </section>
      {core.length > 0 ? (
        <SettingsBlock title={m.plugins_core_title()} description={m.plugins_core_note()}>
          <SettingsGroup>
            {core.map(({ plugin, name, description, icon: Icon }) => (
              <Item key={plugin.id} render={<li />} size="sm">
                <ItemMedia variant="icon" className="text-muted-foreground">
                  <Icon aria-hidden />
                </ItemMedia>
                <ItemContent className="min-w-0 gap-0.5">
                  <ItemTitle>{name}</ItemTitle>
                  <ItemDescription className="line-clamp-1 text-xs">{description}</ItemDescription>
                </ItemContent>
              </Item>
            ))}
          </SettingsGroup>
        </SettingsBlock>
      ) : null}
      <Dialog open={open != null} onOpenChange={(next) => !next && setOpenId(null)}>
        <DialogContent className="flex max-h-[min(44rem,calc(100svh-2rem))] flex-col sm:max-w-xl">
          {open ? <PluginDetails {...actionsFor(open)} /> : null}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={removing ? m.plugins_uninstall_title({ name: removing.name }) : ''}
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
        pending={removingPending}
        onConfirm={() => {
          if (!removing) return
          void uninstall(removing, purge).then((done) => {
            if (done) setConfirming(false)
          })
        }}
      />
    </div>
  )
}
