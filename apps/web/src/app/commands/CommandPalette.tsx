import { useQueries } from '@tanstack/react-query'
import { ChevronRight, CornerDownLeft, FileText, Sparkles } from 'lucide-react'
import { type KeyboardEvent, type ReactNode, useEffect, useState } from 'react'
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

export const RECENT_KEY = 'commands.recent'
const SEARCH_MIN_LENGTH = 2
const SEARCH_DEBOUNCE_MS = 150
/** Navigation entries shown before anything is typed. */
const SUGGESTED_NAVIGATION = 8
const MAX_PER_GROUP = 12

type Entry = Matchable & {
  key: string
  icon?: CommandContribution['icon']
  dot?: string
  hotkey?: string
  /** Opens a second list instead of running. */
  opens?: boolean
  select: () => void | Promise<void>
}

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return delay === 0 ? value : debounced
}

function childEntry(prefix: string, child: CommandChild, ctx: CommandContext): Entry {
  return {
    key: `${prefix}:${child.id}`,
    title: child.title,
    subtitle: child.subtitle,
    keywords: child.keywords,
    icon: child.icon,
    dot: child.dot,
    select: () => ('to' in child ? ctx.navigate(child.to) : child.run(ctx)),
  }
}

function pageEntries(
  pages: ReturnType<typeof useScopePages>['pages'],
  scope: Scope | undefined,
  ctx: CommandContext,
): Entry[] {
  if (!scope) return []
  return pages.map((page) => ({
    key: `page:${scope.kind}:${page.id}`,
    title: page.title(),
    icon: page.icon,
    select: () => ctx.navigate(scopePath(scope, page.id === OVERVIEW_PAGE ? undefined : page.id)),
  }))
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
  return [
    ...pageEntries(here, ctx.scope, ctx),
    ...(ctx.scope?.kind === 'program' ? [] : pageEntries(program, programScope, ctx)),
    ...listed,
  ]
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
      {entry.hotkey ? <CommandShortcut>{formatHotkey(entry.hotkey)}</CommandShortcut> : null}
      {entry.opens ? <ChevronRight aria-hidden className="ml-auto" /> : null}
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
  const providers = modules.flatMap((module) => module.searchProviders ?? [])
  const results = useQueries({
    queries: providers.map((provider) => ({
      queryKey: ['commandPaletteSearch', provider.id, searchText, ctx.scope],
      queryFn: () => provider.search(searchText, ctx.scope),
      enabled: searching,
      staleTime: 30_000,
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

  const searchEntries: Entry[] = searching
    ? results.flatMap((result, index) =>
        (result.data ?? []).map((hit) => ({
          key: `search:${providers[index]?.id}:${hit.id}`,
          title: hit.title,
          subtitle: hit.subtitle,
          select: () => ctx.navigate(hit.to),
        })),
      )
    : []
  const loading = searching && results.some((r) => r.isFetching)

  return (
    <Command label={m.commands_title()} shouldFilter={false} loop onKeyDown={onKeyDown}>
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
            {slash
              ? null
              : group(
                  m.commands_group_navigation(),
                  rank(navigation, text, recent).slice(
                    0,
                    text ? MAX_PER_GROUP : SUGGESTED_NAVIGATION,
                  ),
                )}
            {group(m.commands_group_actions(), rank(actions, text, recent).slice(0, MAX_PER_GROUP))}
            {group(m.commands_group_results(), searchEntries)}
            {assistant && text && !slash ? (
              <CommandGroup heading={m.commands_group_ask()}>
                <CommandItem
                  value="ask"
                  onSelect={() => {
                    close()
                    setTimeout(() => assistant.open(ctx, text), 0)
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
