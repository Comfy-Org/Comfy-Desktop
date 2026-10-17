import fs from 'fs'
import path from 'path'
import type {
  InstallContentsFacet,
  InstallContentsPage,
  InstallContentsRequest
} from '../../../types/ipc'

/** Most entries one listing reads from disk; beyond it the listing is `truncated`. */
export const MAX_LISTED_ENTRIES = 5000
/** Deepest folder level a walk descends into. */
export const MAX_WALK_DEPTH = 8
export const DEFAULT_PAGE_SIZE = 100
export const MAX_PAGE_SIZE = 500

/** Validate a renderer request; malformed input is refused, not coerced. */
export function parseListRequest(raw: unknown): InstallContentsRequest | null {
  if (raw === undefined) return {}
  if (typeof raw !== 'object' || raw === null) return null
  const { query, sort, cursor, limit, filter } = raw as Record<string, unknown>
  if (query !== undefined && typeof query !== 'string') return null
  if (sort !== undefined && sort !== 'modified' && sort !== 'name') return null
  if (cursor !== undefined && typeof cursor !== 'string') return null
  if (limit !== undefined && !(Number.isInteger(limit) && (limit as number) > 0)) return null
  if (filter !== undefined && typeof filter !== 'string') return null
  return {
    query: query as string | undefined,
    sort: sort as InstallContentsRequest['sort'],
    cursor: cursor as string | undefined,
    limit: limit as number | undefined,
    filter: filter as string | undefined
  }
}

export function pageSize(request: InstallContentsRequest): number {
  return Math.min(request.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)
}

export function matchesQuery(text: string, query: string | undefined): boolean {
  const needle = query?.trim().toLowerCase()
  return !needle || text.toLowerCase().includes(needle)
}

/**
 * Filter, sort and page items read in full (local folders, Cloud's workflow
 * list). The cursor is the offset of the next page.
 */
export function pageOf<T>(
  items: readonly T[],
  request: InstallContentsRequest,
  how: { text: (item: T) => string; compare: (a: T, b: T) => number; truncated: boolean }
): InstallContentsPage<T> {
  const matching = items.filter((item) => matchesQuery(how.text(item), request.query))
  matching.sort(how.compare)
  const offset = Math.max(0, Number.parseInt(request.cursor ?? '0', 10) || 0)
  const end = offset + pageSize(request)
  return {
    ok: true,
    items: matching.slice(offset, end),
    nextCursor: end < matching.length ? String(end) : null,
    total: matching.length,
    truncated: how.truncated
  }
}

export interface WalkedFile {
  /** Path relative to the walked root, with `/` separators. */
  relativePath: string
  absolutePath: string
  size: number
  modifiedAt: number
  createdAt: number
  /** The file itself (device and inode), the same through any link to it. */
  fileId: string
}

/**
 * The files under `root` that `accept` keeps, stopping after reading
 * `maxEntries` entries and not descending past `MAX_WALK_DEPTH`; either limit
 * marks the result truncated. Symlinks are followed, as ComfyUI follows them,
 * and each folder is walked once; `stayInside` skips links that lead out of
 * `root`. A missing or unreadable folder reads as empty.
 */
export async function walkFiles(
  root: string,
  accept: (fileName: string) => boolean,
  maxEntries = MAX_LISTED_ENTRIES,
  stayInside = false
): Promise<{ files: WalkedFile[]; truncated: boolean }> {
  const files: WalkedFile[] = []
  const walked = new Set<string>()
  const realRoot = await fs.promises.realpath(root).catch(() => root)
  const isInside = (real: string): boolean => {
    const inside = path.relative(realRoot, real)
    return !inside.startsWith('..') && !path.isAbsolute(inside)
  }
  let visited = 0
  let truncated = false

  async function walk(dir: string, depth: number): Promise<void> {
    let entries: fs.Dirent[]
    try {
      const real = await fs.promises.realpath(dir)
      if (walked.has(real) || (stayInside && !isInside(real))) return
      walked.add(real)
      entries = await fs.promises.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (visited >= maxEntries) {
        truncated = true
        return
      }
      if (entry.name.startsWith('.')) continue
      visited++
      const absolutePath = path.join(dir, entry.name)
      let stat: fs.Stats
      try {
        stat = await fs.promises.stat(absolutePath)
      } catch {
        // Removed while walking, or a broken link: skip it.
        continue
      }
      if (stat.isDirectory()) {
        if (depth < MAX_WALK_DEPTH) await walk(absolutePath, depth + 1)
        else truncated = true
        continue
      }
      if (!stat.isFile() || !accept(entry.name)) continue
      if (stayInside && entry.isSymbolicLink()) {
        const real = await fs.promises.realpath(absolutePath).catch(() => null)
        if (!real || !isInside(real)) continue
      }
      files.push({
        relativePath: path.relative(root, absolutePath).split(path.sep).join('/'),
        absolutePath,
        size: stat.size,
        modifiedAt: stat.mtimeMs,
        createdAt: stat.birthtimeMs || stat.mtimeMs,
        fileId: `${stat.dev}:${stat.ino}`
      })
    }
  }

  await walk(root, 0)
  return { files, truncated }
}

/** How many items have each value, most common first. */
export function countBy<T>(
  items: readonly T[],
  valueOf: (item: T) => string
): InstallContentsFacet[] {
  const counts = new Map<string, number>()
  for (const item of items) counts.set(valueOf(item), (counts.get(valueOf(item)) ?? 0) + 1)
  return [...counts]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
}

export const byName = <T extends { name: string }>(a: T, b: T): number =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
