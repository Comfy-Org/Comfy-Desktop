import { reactive } from 'vue'
import type { MarAsset } from '../pages/assetsStore'
import { factsFor } from './assetFacts'

/**
 * Tags as ComfyUI edits them (Phase 1). One store for both surfaces, so
 * a tag added in ComfyUI's details shows, read-only, in Desktop's.
 */
const edits = reactive<Record<string, string[]>>({})

export const tagsOf = (a: MarAsset): string[] => edits[a.id] ?? factsFor(a).tags

export function addTag(a: MarAsset, tag: string): void {
  const t = tag.trim().replace(/^#/, '').toLowerCase()
  if (t && !tagsOf(a).includes(t)) edits[a.id] = [...tagsOf(a), t]
}

export function removeTag(a: MarAsset, tag: string): void {
  edits[a.id] = tagsOf(a).filter((t) => t !== tag)
}

/** Every one has it: a check by the tag in a menu. */
export const allTagged = (list: MarAsset[], tag: string): boolean =>
  list.length > 0 && list.every((a) => tagsOf(a).includes(tag))

/** On all of them, or off all when they all had it (Add tags ›). */
export function flipTag(list: MarAsset[], tag: string): void {
  const off = allTagged(list, tag)
  for (const a of list) (off ? removeTag : addTag)(a, tag)
}

/** Rename tag (ComfyUI's sidebar): every file with it takes the new name;
 *  one that has both keeps a single copy. Returns the name it took, or
 *  undefined when there was nothing to do. */
export function renameTag(list: MarAsset[], from: string, to: string): string | undefined {
  const t = to.trim().replace(/^#/, '').toLowerCase()
  if (!t || t === from) return undefined
  for (const a of list) {
    const tags = tagsOf(a)
    if (!tags.includes(from)) continue
    edits[a.id] = [...new Set(tags.map((x) => (x === from ? t : x)))]
  }
  return t
}

/** Delete tag (ComfyUI's sidebar): off every file in the list. */
export function deleteTag(list: MarAsset[], tag: string): void {
  for (const a of list) if (tagsOf(a).includes(tag)) removeTag(a, tag)
  const i = newTags.indexOf(tag)
  if (i >= 0) newTags.splice(i, 1)
}

/** Tags made from ComfyUI's sidebar (TAGS › ⋯ › New tag) before any file has them:
 *  they list at 0 until a file takes them. */
export const newTags = reactive<string[]>([])
export function makeTag(name: string): string | undefined {
  const t = name.trim().replace(/^#/, '').toLowerCase()
  if (!t) return undefined
  if (!newTags.includes(t)) newTags.push(t)
  return t
}
