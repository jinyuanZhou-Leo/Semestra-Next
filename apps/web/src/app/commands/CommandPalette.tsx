import { useQueries } from '@tanstack/react-query'
import { ChevronRight, CornerDownLeft, FileText, Sparkles } from 'lucide-react'
import { Fragment, type KeyboardEvent, type ReactNode, useState } from 'react'
import { m } from '@/paraglide/messages'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/ui/command'
import type {
  CommandChild,
  CommandContext,
  CommandContribution,
  ModuleManifest,
  Scope,
} from '../extensions'
import { scopePath } from '../extensions'
import { OVERVIEW_PAGE, useScopePages } from '../host/nav'
import { formatHotkey } from '../hotkeys'
import { useModules } from '../registry'
import { useUiPref } from '../ui-pref'
import { setPalette, usePaletteState } from './bus'
import { useCommandContext } from './context'
import { type Matchable, pushRecent, rank } from './rank'
import { useDebounced } from '@/hooks/use-debounced'

export const RECENT_KEY = 'commands.recent'
const SEARCH_MIN_LENGTH = 2
const SEARCH_DEBOUNCE_MS = 150
/** Navigation entries shown before anything is typed. */
const SUGGESTED_NAVIGATION = 8
const MAX_PER_GROUP = 12
const ASK_KEY = 'ask'

type Entry = Matchable & {
  key: string
  /** Where it goes, so two entries for the same page show once. */
  to?: string
  icon?: CommandContribution['icon']
  dot?: string
  hotkey?: string
  /** Opens a second list instead of running. */
  opens?: boolean
  select: () => void | Promise<void>
}

function childEntry(prefix: string, child: CommandChild, ctx: CommandContext): Entry {
  return {
    key: `${prefix}:${child.id}`,
    title: child.title,
    subtitle: child.subtitle,
    keywords: child.keywords,
    icon: child.icon,
    dot: child.dot,
    to: 'to' in child ? child.to : undefined,
    select: () => ('to' in child ? ctx.navigate(child.to) : child.run(ctx)),
  }
}

function pageEntries(
  pages: ReturnType<typeof useScopePages>['pages'],
  scope: Scope | undefined,
  ctx: CommandContext,
): Entry[] {
  if (!scope) return []
  return pages.map((page) => {
    const to = scopePath(scope, page.id === OVERVIEW_PAGE ? undefined : page.id)
    return {
      key: `page:${scope.kind}:${page.id}`,
      title: page.title(),
      icon: page.icon,
      to,
      select: () => ctx.navigate(to),
    }
  })
}

/** Pages of the scope on screen (and of its Program), then what modules list (terms, courses). */
function useNavigationEntries(ctx: CommandContext, modules: readonly ModuleManifest[]): Entry[] {
  const programScope: Scope | undefined = ctx.programId
    ? { kind: 'program', programId: ctx.programId }
    : undefined
  const fallback: Scope = { kind: 'program', programId: '' }
  const here = useScopePages(ctx.scope ?? fallback).pages
  const program = useScopePages(programScope ?? fallback).pages
  const sources = modules.flatMap((module) => module.navigationSources ?? [])
  // The module list does not change while the palette is open, so the hooks keep their order.
  // oxlint-disable-next-line react/rules-of-hooks
  const listed = sources.flatMap((source) =>
    // oxlint-disable-next-line react/rules-of-hooks
    source.useItems(ctx).map((child) => childEntry(`nav:${source.id}`, child, ctx)),
  )
  const entries = [
    ...pageEntries(here, ctx.scope, ctx),
    ...(ctx.scope?.kind === 'program' ? [] : pageEntries(program, programScope, ctx)),
    ...listed,
  ]
  // A module may list a page the scope lists too (the sidebar's pages, M02 §5.1): once is enough.
  const seen = new Set<string>()
  return entries.filter((entry) => {
    if (entry.to === undefined) return true
    if (seen.has(entry.to)) return false
    seen.add(entry.to)
    return true
  })
}

function commandEntries(
  modules: readonly ModuleManifest[],
  ctx: CommandContext,
  open: (command: CommandContribution) => void,
): Entry[] {
  return modules
    .flatMap((module) => module.commands ?? [])
    .filter(
      (command) =>
        (!command.scopes || (ctx.scope && command.scopes.includes(ctx.scope.kind))) &&
        (command.isAvailable?.(ctx) ?? true),
    )
    .map((command) => ({
      key: `cmd:${command.id}`,
      title: command.title(),
      keywords: command.keywords,
      icon: command.icon,
      hotkey: command.hotkey,
      opens: 'useChildren' in command,
      select: () => {
        if ('useChildren' in command) open(command)
        else if ('to' in command) ctx.navigate(command.to)
        else return command.run(ctx)
      },
    }))
}

/** The second list of a command (e.g. "Switch term →"); its hook runs only while it is open. */
function ChildEntries({
  command,
  ctx,
  query,
  recent,
  render,
}: {
  command: Extract<CommandContribution, { useChildren: unknown }>
  ctx: CommandContext
  query: string
  recent: readonly string[]
  render: (entries: Entry[]) => ReactNode
}) {
  const children = command.useChildren(ctx)
  const entries = children.map((child) => childEntry(`cmd:${command.id}`, child, ctx))
  return render(rank(entries, query, recent))
}

function EntryItem({ entry, onSelect }: { entry: Entry; onSelect: (entry: Entry) => void }) {
  const Icon = entry.icon
  return (
    <CommandItem value={entry.key} onSelect={() => onSelect(entry)}>
      {entry.dot ? (
        <span
          aria-hidden
          className="size-2.5 shrink-0 rounded-full"
          style={{ background: entry.dot }}
        />
      ) : Icon ? (
        <Icon aria-hidden />
      ) : (
        <FileText aria-hidden />
      )}
      <span className="min-w-0 truncate">{entry.title}</span>
      {entry.subtitle ? (
        <span className="min-w-0 truncate text-xs text-muted-foreground">{entry.subtitle}</span>
      ) : null}
      {/* One trailing slot: CommandItem appends a hidden check icon with `ml-auto`, which a
          second `ml-auto` element would split the free space with; `CommandShortcut` hides it. */}
      {entry.hotkey || entry.opens ? (
        <CommandShortcut className="flex items-center gap-1">
          {entry.hotkey ? formatHotkey(entry.hotkey) : null}
          {entry.opens ? <ChevronRight aria-hidden /> : null}
        </CommandShortcut>
      ) : null}
    </CommandItem>
  )
}

function PaletteBody({ initialQuery, close }: { initialQuery: string; close: () => void }) {
  const ctx = useCommandContext()
  const modules = useModules()
  const [recent, setRecent] = useUiPref<string[]>(RECENT_KEY, [])
  const [query, setQuery] = useState(initialQuery)
  const [child, setChild] = useState<CommandContribution | null>(null)
  const slash = !child && query.startsWith('/')
  const text = (slash ? query.slice(1) : query).trim()
  const searchText = useDebounced(text, SEARCH_DEBOUNCE_MS)
  const searching = !child && !slash && searchText.length >= SEARCH_MIN_LENGTH

  const navigation = useNavigationEntries(ctx, modules)
  const actions = commandEntries(modules, ctx, (command) => {
    setChild(command)
    setQuery('')
  })
  const providers = modules
    .flatMap((module) => module.searchProviders ?? [])
    .toSorted((a, b) => a.order - b.order)
  const results = useQueries({
    queries: providers.map((provider) => ({
      queryKey: ['commandPaletteSearch', provider.id, searchText, ctx.scope],
      queryFn: () => provider.search(searchText, ctx.scope, ctx.queryClient),
      enabled: searching,
    })),
  })
  const assistant = modules.find((module) => module.assistant)?.assistant

  const choose = (entry: Entry) => {
    setRecent(pushRecent(recent, entry.key))
    if (entry.opens) {
      void entry.select()
      return
    }
    close()
    // Run after the palette has closed, so a dialog the command opens gets the focus.
    setTimeout(() => void entry.select(), 0)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Backspace' && child && query === '') {
      event.preventDefault()
      setChild(null)
    }
  }

  const group = (heading: string, entries: Entry[]) =>
    entries.length > 0 ? (
      <CommandGroup heading={heading}>
        {entries.map((entry) => (
          <EntryItem key={entry.key} entry={entry} onSelect={choose} />
        ))}
      </CommandGroup>
    ) : null

  // One group per provider, so what a result is reads from its heading.
  const searchGroups = searching
    ? providers.map((provider, index) => ({
        provider,
        entries: (results[index]?.data ?? []).map((hit): Entry => ({
          key: `search:${provider.id}:${hit.id}`,
          title: hit.title,
          subtitle: hit.subtitle,
          icon: hit.icon ?? provider.icon,
          select: () => ctx.navigate(hit.to),
        })),
      }))
    : []
  const navigationShown = slash
    ? []
    : rank(navigation, text, recent).slice(0, text ? MAX_PER_GROUP : SUGGESTED_NAVIGATION)
  const actionsShown = rank(actions, text, recent).slice(0, MAX_PER_GROUP)
  const asking = assistant && text && !slash ? assistant : null
  // Until the user picks a line (arrow keys, pointer) for what is typed, the first line is
  // selected, also when search results arrive after "Ask Sem" was the only line: Enter then opens
  // the best match, not the question. A line the user picked stays picked as more results arrive.
  const firstKey =
    [...navigationShown, ...searchGroups.flatMap((g) => g.entries), ...actionsShown][0]?.key ??
    (asking ? ASK_KEY : '')
  const [selected, setSelected] = useState(firstKey)
  const [picked, setPicked] = useState(false)
  const [shownFirst, setShownFirst] = useState(firstKey)
  const [typed, setTyped] = useState(text)
  if (text !== typed) {
    setTyped(text)
    setPicked(false)
  }
  if (firstKey !== shownFirst) {
    setShownFirst(firstKey)
    if (!picked || text !== typed) setSelected(firstKey)
  }
  const pick = (value: string) => {
    setSelected(value)
    if (value !== firstKey) setPicked(true)
  }
  const loading = searching && results.some((r) => r.isFetching)

  return (
    <Command
      label={m.commands_title()}
      shouldFilter={false}
      loop
      onKeyDown={onKeyDown}
      // A second list picks its own first line.
      value={child ? undefined : selected}
      onValueChange={pick}
    >
      {child ? (
        <span className="mx-2 mt-1 flex w-fit items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs">
          {child.title()}
          <ChevronRight aria-hidden className="size-3" />
        </span>
      ) : null}
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder={child ? m.commands_filter_placeholder() : m.commands_placeholder()}
      />
      <CommandList>
        <CommandEmpty>{loading ? m.common_loading() : m.commands_empty()}</CommandEmpty>
        {child && 'useChildren' in child ? (
          <ChildEntries
            key={child.id}
            command={child}
            ctx={ctx}
            query={text}
            recent={recent}
            render={(entries) => group(child.title(), entries.slice(0, 50))}
          />
        ) : (
          <>
            {group(m.commands_group_navigation(), navigationShown)}
            {searchGroups.map(({ provider, entries }) => (
              <Fragment key={provider.id}>{group(provider.title(), entries)}</Fragment>
            ))}
            {group(m.commands_group_actions(), actionsShown)}
            {asking ? (
              <CommandGroup heading={m.commands_group_ask()}>
                <CommandItem
                  value={ASK_KEY}
                  onSelect={() => {
                    close()
                    setTimeout(() => asking.open(ctx, text), 0)
                  }}
                >
                  <Sparkles aria-hidden />
                  <span className="min-w-0 truncate">{m.commands_ask({ question: text })}</span>
                  <CommandShortcut>
                    <CornerDownLeft aria-hidden />
                  </CommandShortcut>
                </CommandItem>
              </CommandGroup>
            ) : null}
          </>
        )}
      </CommandList>
    </Command>
  )
}

/**
 * The command palette (M10 §5.4), `Cmd/Ctrl + K`: navigation, the modules' commands, search
 * results and "Ask AI". Typing `/` lists only commands; Backspace in an empty second list goes
 * back. Mounted once in the signed-in layout; open it with `openCommandPalette()`.
 */
export function CommandPalette() {
  const { open, query } = usePaletteState()
  const close = () => setPalette({ open: false, query: '' })
  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => (next ? undefined : close())}
      title={m.commands_title()}
      description={m.commands_placeholder()}
      className="sm:max-w-xl"
    >
      {open ? <PaletteBody initialQuery={query} close={close} /> : null}
    </CommandDialog>
  )
}
