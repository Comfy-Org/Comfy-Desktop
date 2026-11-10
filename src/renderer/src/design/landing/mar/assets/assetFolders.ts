import { reactive, watch } from 'vue'
import { assets } from '../pages/assetsStore'
import { graphLibrary } from '../graph/comfyLook'
import { folderDepth } from './folderDepth'

/**
 * Folders for ComfyUI's Assets tab, alongside tags: a file sits in
 * one folder, folders nest. Made from the sidebar, filled from a file's
 * menu, the select bar, or by dragging cards onto a row. Kept for the
 * visit, like labels.
 */
export interface AssetFolder {
  id: string
  name: string
  parent?: string
}

export const folders = reactive<AssetFolder[]>([
  { id: 'f-client', name: 'Client work' },
  { id: 'f-moodboards', name: 'Moodboards', parent: 'f-client' },
  { id: 'f-tests', name: 'Model tests' }
])
const placed = reactive<Record<string, string>>({})
let next = 0

// A few files already filed, so the demo folders aren't empty.
const FILED: [RegExp, string][] = [
  [/^hero_shot_|^upscaled_/, 'f-client'],
  [/^moodboard_|_ref[._]/, 'f-moodboards'],
  [/^relight_|^alpine_|^storyboard_/, 'f-tests']
]
const filed = new Set<string>()
watch(
  () => assets.items.map((a) => a.id).join(),
  () => {
    for (const a of assets.items) {
      if (filed.has(a.id)) continue
      filed.add(a.id)
      const f = FILED.find(([re]) => re.test(a.name))?.[1]
      if (f) placed[a.id] = f
    }
  },
  { immediate: true }
)

export const folderOf = (id: string): string | undefined => placed[id]
export const folderName = (id?: string): string | undefined =>
  folders.find((f) => f.id === id)?.name

/** The folder and every folder inside it. */
export function within(id: string): Set<string> {
  const out = new Set([id])
  for (let grew = true; grew; ) {
    grew = false
    for (const f of folders)
      if (f.parent && out.has(f.parent) && !out.has(f.id)) {
        out.add(f.id)
        grew = true
      }
  }
  return out
}

/** Folders in reading order, each with how deep it sits. */
export function tree(): { folder: AssetFolder; depth: number }[] {
  const out: { folder: AssetFolder; depth: number }[] = []
  const walk = (parent: string | undefined, depth: number): void => {
    for (const f of folders.filter((x) => x.parent === parent)) {
      out.push({ folder: f, depth })
      walk(f.id, depth + 1)
    }
  }
  walk(undefined, 0)
  return out
}

export function addFolder(name: string, parent?: string): AssetFolder {
  const f = { id: `f-new-${++next}`, name: name.trim() || 'New folder', parent }
  folders.push(f)
  return f
}

export function renameFolder(id: string, name: string): void {
  const f = folders.find((x) => x.id === id)
  if (f && name.trim()) f.name = name.trim()
}

/** Its files and subfolders go up a level, nothing is lost. */
export function removeFolder(id: string): void {
  const f = folders.find((x) => x.id === id)
  if (!f) return
  for (const x of folders) if (x.parent === id) x.parent = f.parent
  for (const [a, at] of Object.entries(placed))
    if (at === id) {
      if (f.parent) placed[a] = f.parent
      else delete placed[a]
    }
  folders.splice(folders.indexOf(f), 1)
}

/** No folder takes them out of every folder. */
export function moveToFolder(ids: string[], folder?: string): void {
  for (const id of ids) {
    if (folder) placed[id] = folder
    else delete placed[id]
  }
}

// UI Playground › Folders › Deep (folderDepth.ts): a client tree eight
// levels down, siblings on the way, a few files at each level.
const DEEP: AssetFolder[] = [
  { id: 'f-deep-1', name: 'Acme Corporation', parent: 'f-client' },
  { id: 'f-deep-2', name: '2026', parent: 'f-deep-1' },
  { id: 'f-deep-2b', name: '2025 archive', parent: 'f-deep-1' },
  { id: 'f-deep-3', name: 'Q4 holiday campaign', parent: 'f-deep-2' },
  { id: 'f-deep-3b', name: 'Q3 back to school', parent: 'f-deep-2' },
  { id: 'f-deep-4', name: 'Hero shots', parent: 'f-deep-3' },
  { id: 'f-deep-4b', name: 'Social cutdowns', parent: 'f-deep-3' },
  { id: 'f-deep-5', name: 'Product on white, all angles', parent: 'f-deep-4' },
  { id: 'f-deep-6', name: 'Finals', parent: 'f-deep-5' },
  { id: 'f-deep-6b', name: 'Rejected', parent: 'f-deep-5' },
  { id: 'f-deep-7', name: 'Retouched', parent: 'f-deep-6' },
  { id: 'f-deep-8', name: 'Approved by client', parent: 'f-deep-7' }
]
const AT = ['f-deep-1', 'f-deep-3', 'f-deep-4', 'f-deep-5', 'f-deep-6', 'f-deep-7', 'f-deep-8']
watch(
  () => [folderDepth.id, graphLibrary.items.length, assets.items.length] as const,
  ([depth]) => {
    for (const f of [...folders].filter((x) => x.id.startsWith('f-deep-')))
      folders.splice(folders.indexOf(f), 1)
    for (const [a, at] of Object.entries(placed)) if (at.startsWith('f-deep-')) delete placed[a]
    if (depth !== 'deep') return
    folders.push(...DEEP.map((f) => ({ ...f })))
    const files = [...graphLibrary.items, ...assets.items].filter((a) => !placed[a.id])
    files.slice(0, AT.length * 2).forEach((a, i) => (placed[a.id] = AT[i % AT.length]!))
  },
  { immediate: true }
)
