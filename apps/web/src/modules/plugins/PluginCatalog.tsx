import type { PluginOut } from '@semestra/api-client'
import { clearOnEscape, clearSearch } from '@/lib/search-input'
import { pluginsPluginInstall, pluginsPluginUninstall } from '@semestra/api-client'
import { pluginsCatalogListOptions } from '@semestra/api-client/react-query'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import {
  Blocks,
  Download,
  LayoutGrid,
  PanelTop,
  Search,
  SearchX,
  Trash2,
  type LucideIcon,
  X,
} from 'lucide-react'
import { LayoutGroup, LazyMotion, MotionConfig, domMax } from 'motion/react'
import * as motionM from 'motion/react-m'
import { useId, useState } from 'react'
import { toast } from 'sonner'
import { invalidateOperations } from '@/app/api'
import type { ModuleManifest } from '@/app/extensions'
import { useAllModules } from '@/app/registry'
import { useMotionPreference } from '@/app/theme'
import { PluginSettingsSections, RowMenu, SettingsBlock, SettingsGroup } from '@/app/settings'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { useDialogTarget } from '@/lib/dialog-target'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Checkbox } from '@/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/ui/dialog'
import { DropdownMenuItem } from '@/ui/dropdown-menu'
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/ui/field'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/ui/input-group'
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/ui/item'
import { Separator } from '@/ui/separator'
import { Spinner } from '@/ui/spinner'

/** What the user sees of a catalog entry: the frontend manifest when the module has one. */
const EASE = [0.32, 0.72, 0, 1] as const

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
      'layoutsCardGetSettings',
    ])

  const install = async (entry: Entry) => {
    const id = entry.plugin.id
    start(id)
    try {
      await pluginsPluginInstall({ path: { plugin_id: id }, throwOnError: true })
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
      await pluginsPluginUninstall({
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
}

/**
 * "Install" for a plugin that is not installed; the "⋯" menu with "Uninstall" for one that is.
 * While a change runs, a spinner takes the place of the icon so the control keeps its width.
 */
function PluginAction({ entry, pending, onInstall, onUninstall }: ActionProps) {
  if (!entry.plugin.installed) {
    return (
      <Button size="sm" disabled={pending} onClick={onInstall}>
        {pending ? <Spinner aria-label={m.common_loading()} /> : <Download aria-hidden />}
        {m.plugins_install()}
      </Button>
    )
  }
  if (pending) {
    return (
      <Button variant="ghost" size="icon-sm" disabled aria-label={m.common_loading()}>
        <Spinner aria-hidden />
      </Button>
    )
  }
  return (
    <RowMenu label={m.plugins_installed_menu({ name: entry.name })}>
      <DropdownMenuItem variant="destructive" onClick={onUninstall}>
        <Trash2 aria-hidden />
        {m.plugins_uninstall()}
      </DropdownMenuItem>
    </RowMenu>
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
 * A marketplace card: icon, name and the whole description, with the action at the top right.
 * The whole card opens the details (the name's button stretches over it); the action sits above
 * that overlay so it works on its own.
 */
function PluginCard(props: ActionProps & { onOpen: () => void }) {
  const { entry, onOpen } = props
  return (
    <Item
      variant="outline"
      // Installing or uninstalling moves the card to the other group: it glides there.
      render={<motionM.li layout="position" layoutId={entry.plugin.id} />}
      className="relative h-full min-w-0 flex-nowrap items-start gap-3 p-4 transition-colors hover:bg-muted/50"
    >
      <PluginIcon icon={entry.icon} />
      <ItemContent className="min-w-0 gap-1">
        <ItemTitle className="w-full">
          <button
            type="button"
            onClick={onOpen}
            className="max-w-full min-w-0 truncate text-left outline-none after:absolute after:inset-0 after:rounded-[inherit] focus-visible:after:ring-3 focus-visible:after:ring-ring/50"
          >
            {entry.name}
          </button>
        </ItemTitle>
        <ItemDescription className="line-clamp-none">{entry.description}</ItemDescription>
      </ItemContent>
      <div className="relative -mt-0.5 shrink-0">
        <PluginAction {...props} />
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
    <SettingsBlock title={title}>
      <SettingsGroup>
        {items.map((item) => (
          <Item key={item.id} render={<li />} size="sm">
            <ItemMedia variant="icon" className="text-muted-foreground">
              <Icon aria-hidden />
            </ItemMedia>
            <ItemContent className="min-w-0 gap-0.5">
              <ItemTitle>{item.title}</ItemTitle>
              {item.description ? (
                <ItemDescription className="text-xs">{item.description}</ItemDescription>
              ) : null}
            </ItemContent>
          </Item>
        ))}
      </SettingsGroup>
    </SettingsBlock>
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
              {m.plugins_version({ version: plugin.version })}
            </DialogDescription>
          </div>
          <PluginAction {...props} />
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
 * The "Plugins" settings section (M10 §5.3): the plugins in two groups, installed and not
 * installed, each a grid of cards with the whole description. Core features are not listed: they
 * cannot be uninstalled, and the settings sidebar already shows them.
 */
export default function PluginCatalog() {
  const { data } = useSuspenseQuery(pluginsCatalogListOptions())
  const modules = useAllModules()
  const purgeId = useId()
  const { pending, install, uninstall } = usePluginActions()
  const [search, setSearch] = useState('')
  const details = useDialogTarget<string>()
  const removing = useDialogTarget<Entry>()
  const [purge, setPurge] = useState(false)
  const motionPreference = useMotionPreference()

  const entries = data.items.map((plugin) => toEntry(plugin, modules))
  const query = search.trim().toLocaleLowerCase()
  const plugins = entries.filter((e) => e.plugin.kind === 'plugin')
  const visible = plugins.filter((e) => matches(e, query))
  const open = plugins.find((e) => e.plugin.id === details.target)
  const removingPending = removing.target != null && pending.includes(removing.target.plugin.id)

  const actionsFor = (entry: Entry): ActionProps => ({
    entry,
    pending: pending.includes(entry.plugin.id),
    onInstall: () => void install(entry),
    onUninstall: () => {
      setPurge(false)
      removing.show(entry)
    },
  })

  // Opened from the details dialog, the confirmation is nested in it, so Esc closes only the
  // confirmation even before focus has moved into it.
  const confirm = (
    <ConfirmDialog
      {...removing.props}
      title={removing.target ? m.plugins_uninstall_title({ name: removing.target.name }) : ''}
      description={m.plugins_uninstall_description()}
      extra={
        <Field orientation="horizontal" className="items-start">
          <Checkbox id={purgeId} checked={purge} onCheckedChange={(checked) => setPurge(checked)} />
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
        const entry = removing.target
        if (!entry) return
        void uninstall(entry, purge).then((done) => {
          if (done) removing.close()
        })
      }}
    />
  )

  const card = (entry: Entry) => (
    <PluginCard
      key={entry.plugin.id}
      {...actionsFor(entry)}
      onOpen={() => details.show(entry.plugin.id)}
    />
  )
  const groups = [
    {
      id: 'installed',
      title: m.plugins_installed(),
      entries: visible.filter((e) => e.plugin.installed),
    },
    {
      id: 'available',
      title: m.plugins_group_available(),
      entries: visible.filter((e) => !e.plugin.installed),
    },
  ].filter((group) => group.entries.length > 0)
  const [shownAtOpen] = useState(() => new Set(groups.map((group) => group.id)))

  return (
    <div className="space-y-8">
      {/* The section above already says "Plugins": the marketplace goes without a heading. */}
      <section aria-label={m.plugins_available()} className="@container space-y-6">
        <InputGroup>
          <InputGroupInput
            type="search"
            aria-label={m.plugins_search()}
            placeholder={m.plugins_search()}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={clearOnEscape(search, () => setSearch(''))}
          />
          <InputGroupAddon>
            <Search aria-hidden />
          </InputGroupAddon>
          <InputGroupAddon align="inline-end">
            {search ? (
              <InputGroupButton
                size="icon-xs"
                aria-label={m.common_search_clear()}
                onClick={(event) => clearSearch(event, () => setSearch(''))}
              >
                <X aria-hidden />
              </InputGroupButton>
            ) : null}
          </InputGroupAddon>
        </InputGroup>
        <LazyMotion features={domMax} strict>
          <MotionConfig
            reducedMotion={motionPreference}
            transition={{ duration: 0.24, ease: EASE }}
          >
            <LayoutGroup>
              {/* A group that appears later fades in; one whose last card leaves goes at once
                  (that card is already gliding to the other group). */}
              {groups.map((group) => (
                <motionM.div
                  key={group.id}
                  layout="position"
                  initial={shownAtOpen.has(group.id) ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                >
                  <SettingsBlock title={group.title}>
                    <ul className="grid gap-3 @2xl:grid-cols-2">{group.entries.map(card)}</ul>
                  </SettingsBlock>
                </motionM.div>
              ))}
            </LayoutGroup>
          </MotionConfig>
        </LazyMotion>
        {visible.length > 0 ? null : plugins.length === 0 ? (
          <Empty className="border-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Blocks aria-hidden />
              </EmptyMedia>
              <EmptyTitle>{m.plugins_none_available()}</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <Empty className="border-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchX aria-hidden />
              </EmptyMedia>
              <EmptyTitle>{m.plugins_no_match()}</EmptyTitle>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="outline" onClick={() => setSearch('')}>
                {m.common_clear_filters()}
              </Button>
            </EmptyContent>
          </Empty>
        )}
      </section>
      <Dialog {...details.props}>
        <DialogContent className="flex max-h-[min(44rem,calc(100svh-2rem))] flex-col sm:max-w-xl">
          {open ? <PluginDetails {...actionsFor(open)} /> : null}
          {open ? confirm : null}
        </DialogContent>
      </Dialog>
      {open ? null : confirm}
    </div>
  )
}
