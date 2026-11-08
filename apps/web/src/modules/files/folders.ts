import type { FolderOut, ItemOut } from '@semestra/api-client'

/** Folders nest at most this deep (the API's `files.folder_depth`). */
export const MAX_FOLDER_DEPTH = 3

/** A file or folder the user acts on: rename, move, delete, select, drag. */
export type Target = { type: 'item'; item: ItemOut } | { type: 'folder'; folder: FolderOut }

/** "item:<id>" or "folder:<id>": one key space for selection and dragging. */
export function targetKey(target: Target): string {
  return target.type === 'item' ? `item:${target.item.id}` : `folder:${target.folder.id}`
}

export function targetName(target: Target): string {
  return target.type === 'item' ? target.item.display_name : target.folder.name
}

/** The folder a target sits in (null = the course's top level). */
export function targetParent(target: Target): string | null {
  return target.type === 'item' ? target.item.folder_id : target.folder.parent_id
}

export function compareNames(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

/**
 * A course's folders, indexed once: build it when the folders change and pass it to the checks
 * below, which run for every row of a tree or list while picking or dragging.
 */
export type FolderTree = {
  byId: ReadonlyMap<string, FolderOut>
  /** Child folders of each folder (`null` = top level), sorted by name. */
  children: ReadonlyMap<string | null, readonly FolderOut[]>
  /** Levels from the top: a top-level folder is 1. */
  depth: ReadonlyMap<string, number>
  /** Levels in each folder's own subtree, counting the folder. */
  height: ReadonlyMap<string, number>
  /** Each folder's ancestors (not itself). */
  ancestors: ReadonlyMap<string, ReadonlySet<string>>
}

export function folderTree(folders: readonly FolderOut[]): FolderTree {
  const byId = new Map(folders.map((f) => [f.id, f]))
  const children = new Map<string | null, FolderOut[]>()
  for (const folder of folders.toSorted((a, b) => compareNames(a.name, b.name))) {
    const parent = folder.parent_id && byId.has(folder.parent_id) ? folder.parent_id : null
    const list = children.get(parent) ?? []
    list.push(folder)
    children.set(parent, list)
  }
  const depth = new Map<string, number>()
  const ancestors = new Map<string, Set<string>>()
  const height = new Map<string, number>()
  const visit = (folder: FolderOut, above: Set<string>): number => {
    depth.set(folder.id, above.size + 1)
    ancestors.set(folder.id, above)
    const inside = new Set(above).add(folder.id)
    let tallest = 0
    for (const child of children.get(folder.id) ?? [])
      tallest = Math.max(tallest, visit(child, inside))
    height.set(folder.id, tallest + 1)
    return tallest + 1
  }
  for (const top of children.get(null) ?? []) visit(top, new Set())
  return { byId, children, depth, height, ancestors }
}

/** Levels from the top of `folderId`; the course itself (null) is 0. */
export function depthOf(folderId: string | null, tree: FolderTree): number {
  return folderId ? (tree.depth.get(folderId) ?? 0) : 0
}

/** The folders on the way to `folderId`, top first. */
export function pathTo(folderId: string | null, tree: FolderTree): FolderOut[] {
  const path: FolderOut[] = []
  let step = folderId ? tree.byId.get(folderId) : undefined
  while (step && !path.includes(step)) {
    path.unshift(step)
    step = step.parent_id ? tree.byId.get(step.parent_id) : undefined
  }
  return path
}

/** Whether folders among `targets` fit in a place `depth` deep below the folders `above`. */
function fitsUnder(
  targets: readonly Target[],
  depth: number,
  above: ReadonlySet<string>,
  tree: FolderTree,
): boolean {
  return targets.every(
    (t) =>
      t.type === 'item' ||
      (!above.has(t.folder.id) && depth + (tree.height.get(t.folder.id) ?? 1) <= MAX_FOLDER_DEPTH),
  )
}

/**
 * Whether `targets` can move into `folderId` (null = top level): not where they all already
 * are, not a folder into itself or below itself, and no deeper than the API allows.
 */
export function canMoveInto(
  targets: readonly Target[],
  folderId: string | null,
  tree: FolderTree,
): boolean {
  if (targets.length === 0 || targets.every((t) => targetParent(t) === folderId)) return false
  const above = new Set(folderId ? [...(tree.ancestors.get(folderId) ?? []), folderId] : [])
  return fitsUnder(targets, depthOf(folderId, tree), above, tree)
}

/** Whether `targets` could move into a new, empty folder made inside `parentId`. */
export function canMoveIntoNewFolder(
  targets: readonly Target[],
  parentId: string | null,
  tree: FolderTree,
): boolean {
  const above = new Set(parentId ? [...(tree.ancestors.get(parentId) ?? []), parentId] : [])
  return targets.length > 0 && fitsUnder(targets, depthOf(parentId, tree) + 1, above, tree)
}

/** Files in a folder and all its subfolders. */
export function filesInside(folderId: string, tree: FolderTree, items: readonly ItemOut[]): number {
  return items.filter(
    (i) =>
      i.folder_id && (i.folder_id === folderId || tree.ancestors.get(i.folder_id)?.has(folderId)),
  ).length
}
