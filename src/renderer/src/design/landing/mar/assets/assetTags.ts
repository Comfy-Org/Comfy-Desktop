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
