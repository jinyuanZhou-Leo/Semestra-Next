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

/** Child folders of each folder (`null` = top level), sorted by name. */
export function childrenOf(folders: readonly FolderOut[]): Map<string | null, FolderOut[]> {
  const children = new Map<string | null, FolderOut[]>()
  for (const folder of folders.toSorted((a, b) => compareNames(a.name, b.name))) {
    const list = children.get(folder.parent_id) ?? []
    list.push(folder)
    children.set(folder.parent_id, list)
  }
  return children
}

/** The folder and everything under it. */
export function subtreeIds(folderId: string, folders: readonly FolderOut[]): Set<string> {
  const children = childrenOf(folders)
  const ids = new Set<string>()
  const stack = [folderId]
  while (stack.length > 0) {
    const id = stack.pop()!
    if (ids.has(id)) continue
    ids.add(id)
    for (const child of children.get(id) ?? []) stack.push(child.id)
  }
  return ids
}

/** Levels from the top: a top-level folder is 1; the course itself is 0. */
export function depthOf(folderId: string | null, folders: readonly FolderOut[]): number {
  const byId = new Map(folders.map((f) => [f.id, f]))
  let depth = 0
  const seen = new Set<string>()
  let step = folderId ? byId.get(folderId) : undefined
  while (step && !seen.has(step.id)) {
    seen.add(step.id)
    depth += 1
    step = step.parent_id ? byId.get(step.parent_id) : undefined
  }
  return depth
}

/** Levels in the folder's own subtree, counting the folder. */
function heightOf(folderId: string, children: Map<string | null, FolderOut[]>): number {
  return 1 + Math.max(0, ...(children.get(folderId) ?? []).map((c) => heightOf(c.id, children)))
}

/** The folders on the way to `folderId`, top first. */
export function pathTo(folderId: string | null, folders: readonly FolderOut[]): FolderOut[] {
  const byId = new Map(folders.map((f) => [f.id, f]))
  const path: FolderOut[] = []
  let step = folderId ? byId.get(folderId) : undefined
  while (step && !path.includes(step)) {
    path.unshift(step)
    step = step.parent_id ? byId.get(step.parent_id) : undefined
  }
  return path
}

/**
 * Whether `targets` can move into `folderId` (null = top level): not where they all already
 * are, not a folder into itself or below itself, and no deeper than the API allows.
 */
export function canMoveInto(
  targets: readonly Target[],
  folderId: string | null,
  folders: readonly FolderOut[],
): boolean {
  if (targets.length === 0) return false
  if (targets.every((t) => targetParent(t) === folderId)) return false
  const children = childrenOf(folders)
  const depth = depthOf(folderId, folders)
  return targets.every((t) => {
    if (t.type === 'item') return true
    if (folderId && subtreeIds(t.folder.id, folders).has(folderId)) return false
    return depth + heightOf(t.folder.id, children) <= MAX_FOLDER_DEPTH
  })
}

/** Files in a folder and all its subfolders. */
export function filesInside(
  folderId: string,
  folders: readonly FolderOut[],
  items: readonly ItemOut[],
): number {
  const ids = subtreeIds(folderId, folders)
  return items.filter((i) => i.folder_id && ids.has(i.folder_id)).length
}
