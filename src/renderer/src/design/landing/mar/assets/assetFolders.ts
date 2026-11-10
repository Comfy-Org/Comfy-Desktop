import { reactive } from 'vue'

/**
 * Folders for ComfyUI's Media Assets tab, alongside tags: a file sits in
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
